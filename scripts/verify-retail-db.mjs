import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';

const db=new PrismaClient();
try {
 const requiredTables=['PosRefundSettlement','LoyaltyEntry','LoyaltyAdjustment','PosReturn','PosShift','PosExchange','OnlineReturn','OnlineReturnLine','OnlineRefundSettlement','LoyaltyRedemption'];
 const tables=await db.$queryRawUnsafe('SELECT tablename FROM pg_tables WHERE schemaname = $1','public');
 const actual=new Set(tables.map(x=>x.tablename));
 for(const table of requiredTables)assert(actual.has(table),`Missing table: ${table}`);

 const constraints=await db.$queryRawUnsafe(`
  SELECT c.conname, t.relname AS table_name, pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname IN ('PosRefundSettlement','LoyaltyAdjustment','PosExchange','OnlineReturn','OnlineReturnLine','OnlineRefundSettlement','LoyaltyRedemption')
 `);
 const has=(table,fragment)=>constraints.some(x=>x.table_name===table&&x.definition.includes(fragment));
 assert(constraints.some(x=>x.table_name==='PosRefundSettlement'&&/CHECK\s*\(/i.test(x.definition)&&/amount/i.test(x.definition)&&/>/.test(x.definition)),'Refund amount must be positive');
 assert(has('PosRefundSettlement','FOREIGN KEY ("payoutShiftId")'),'Payout shift FK missing');
 assert(constraints.some(x=>x.table_name==='LoyaltyAdjustment'&&/CHECK\s*\(/i.test(x.definition)&&/points/i.test(x.definition)&&/</.test(x.definition)),'Loyalty reversal must be negative');
 assert(has('LoyaltyRedemption','FOREIGN KEY ("customerId")'),'Redemption customer FK missing');
 assert(constraints.some(x=>x.table_name==='LoyaltyRedemption'&&x.definition.includes('CHECK')&&x.definition.includes('points')&&x.definition.includes('>')),'Redemption points must be positive');
 assert(has('LoyaltyAdjustment','FOREIGN KEY ("sourceEntryId")'),'Loyalty source FK missing');
 assert(has('PosExchange','FOREIGN KEY ("returnId")'),'Exchange return FK missing');
 assert(has('PosExchange','FOREIGN KEY ("replacementSaleId")'),'Exchange replacement sale FK missing');
 assert(has('OnlineReturn','FOREIGN KEY ("orderId")'),'Online return order FK missing');
 assert(has('OnlineReturnLine','FOREIGN KEY ("returnId")'),'Online return line FK missing');
 assert(has('OnlineRefundSettlement','FOREIGN KEY ("returnId")'),'Online refund FK missing');
 assert(constraints.some(x=>x.table_name==='OnlineRefundSettlement'&&/CHECK\s*\(/i.test(x.definition)&&/amount/i.test(x.definition)&&/>/.test(x.definition)),'Online refund amount must be positive');

 const indexes=await db.$queryRawUnsafe(`
 SELECT tablename,indexdef FROM pg_indexes WHERE schemaname='public'
 AND tablename IN ('PosRefundSettlement','LoyaltyAdjustment','LoyaltyEntry','PosExchange','OnlineReturn','OnlineReturnLine','OnlineRefundSettlement','LoyaltyRedemption')
 `);
 for(const [table,column] of [['PosRefundSettlement','idempotencyKey'],['LoyaltyAdjustment','idempotencyKey'],['LoyaltyEntry','orderId'],['PosExchange','idempotencyKey'],['PosExchange','returnId'],['PosExchange','replacementSaleId'],['OnlineReturn','idempotencyKey'],['OnlineRefundSettlement','idempotencyKey'],['LoyaltyRedemption','idempotencyKey']]){
  assert(indexes.some(x=>x.tablename===table&&x.indexdef.includes('UNIQUE')&&x.indexdef.includes('"'+column+'"')),`Missing unique index on ${table}.${column}`);
 }
 const shiftColumn=await db.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='PosRefundSettlement' AND column_name='payoutShiftId'`);
 assert.equal(shiftColumn.length,1,'Refund payout shift column missing');

 // Exercise real PostgreSQL CHECK and UNIQUE constraints inside a rolled-back transaction.
 // No customer, order, or financial records are persisted by these probes.
 const probe=async(statement,params,expected)=>{
  await assert.rejects(
   db.$transaction(async tx=>{await tx.$executeRawUnsafe(statement,...params);}),
   e=>{const msg=String(e.message??e);assert(msg.toLowerCase().includes(expected),`Expected PostgreSQL ${expected} violation, received: ${msg}`);return true;}
  );
 };
 const uid='00000000-0000-4000-8000-000000000001';
 await probe('INSERT INTO "OnlineRefundSettlement" ("id","returnId","idempotencyKey","method","amount","reference","settledById") VALUES ($1::uuid,$1::uuid,$2,$3,$4,$5,$1::uuid)',[uid,'probe-negative-online-refund','CASH',-1,'probe'],'check constraint');
 await probe('INSERT INTO "OnlineRefundSettlement" ("id","returnId","idempotencyKey","method","amount","reference","settledById") VALUES ($1::uuid,$1::uuid,$2,$3,$4,$5,$1::uuid)',[uid,'probe-invalid-refund-method','INVALID',1,'probe'],'check constraint');
 await probe('INSERT INTO "OnlineReturnLine" ("id","returnId","variantId","quantity","unitPrice") VALUES ($1::uuid,$1::uuid,$1::uuid,$2,$3)',[uid,0,1],'check constraint');
 await probe('INSERT INTO "LoyaltyAdjustment" ("id","customerId","sourceEntryId","idempotencyKey","points","reason","actorId") VALUES ($1::uuid,$1::uuid,$1::uuid,$2,$3,$4,$1::uuid)',[uid,'probe-positive-loyalty-adjustment',1,'probe'],'check constraint');
 await probe('INSERT INTO "LoyaltyRedemption" ("id","customerId","idempotencyKey","points","reference","reason","actorId") VALUES ($1::uuid,$1::uuid,$2,$3,$4,$5,$1::uuid)',[uid,'probe-zero-point-redemption',0,'probe','probe reason'],'check constraint');
 // Compile the liability report's SQL against migrated PostgreSQL tables, even with an empty database.
 const liabilityPlan=await db.$queryRawUnsafe(`EXPLAIN
 WITH approved AS (
 SELECT 'POS'::text AS channel,r.id AS "returnId",r."createdAt" AS "approvedAt",
 COALESCE((SELECT SUM(l."refundAmount") FROM "PosReturnLine" l WHERE l."returnId"=r.id),0)::numeric AS approved,
 COALESCE((SELECT SUM(s.amount) FROM "PosRefundSettlement" s WHERE s."returnId"=r.id),0)::numeric AS paid
 FROM "PosReturn" r WHERE r.status='APPROVED'
 UNION ALL
 SELECT 'ONLINE'::text AS channel,r.id AS "returnId",r."createdAt" AS "approvedAt",r."merchandiseAmount"::numeric AS approved,
 COALESCE((SELECT SUM(s.amount) FROM "OnlineRefundSettlement" s WHERE s."returnId"=r.id),0)::numeric AS paid
 FROM "OnlineReturn" r JOIN "OnlineOrder" o ON o.id=r."orderId"
 ) SELECT channel,"returnId",approved,paid,approved-paid AS outstanding,"approvedAt"
 FROM approved WHERE approved>paid ORDER BY "approvedAt" ASC,"returnId" ASC`);
 assert(liabilityPlan.length>0,'Refund liability report SQL must compile');
 console.log('Retail finance database migrations, constraints, and rollback-only negative probes verified.');
} finally {await db.$disconnect();}
