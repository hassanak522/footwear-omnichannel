import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
 const guards=await db.$queryRawUnsafe(`SELECT tgname,relname FROM pg_trigger JOIN pg_class ON pg_class.oid=tgrelid WHERE NOT tgisinternal AND tgname IN ('OnlineRefundSettlement_balance_guard','PosRefundSettlement_balance_guard')`);
 assert(guards.some(x=>x.tgname==='OnlineRefundSettlement_balance_guard'&&x.relname==='OnlineRefundSettlement'),'Online refund cap trigger missing');
 assert(guards.some(x=>x.tgname==='PosRefundSettlement_balance_guard'&&x.relname==='PosRefundSettlement'),'POS refund cap trigger missing');
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
 await probe('INSERT INTO "OnlineRefundSettlement" ("id","returnId","idempotencyKey","method","amount","reference","settledById") VALUES ($1::uuid,$1::uuid,$2,$3,$4,$5,$1::uuid)',[uid,'probe-negative-online-refund','CASH',-1,'probe'],'Online refund return does not exist');
 await probe('INSERT INTO "OnlineRefundSettlement" ("id","returnId","idempotencyKey","method","amount","reference","settledById") VALUES ($1::uuid,$1::uuid,$2,$3,$4,$5,$1::uuid)',[uid,'probe-invalid-refund-method','INVALID',1,'probe'],'Online refund return does not exist');
 await probe('INSERT INTO "OnlineReturnLine" ("id","returnId","variantId","quantity","unitPrice") VALUES ($1::uuid,$1::uuid,$1::uuid,$2,$3)',[uid,0,1],'check constraint');
 await probe('INSERT INTO "LoyaltyAdjustment" ("id","customerId","sourceEntryId","idempotencyKey","points","reason","actorId") VALUES ($1::uuid,$1::uuid,$1::uuid,$2,$3,$4,$1::uuid)',[uid,'probe-positive-loyalty-adjustment',1,'probe'],'check constraint');
 await probe('INSERT INTO "LoyaltyRedemption" ("id","customerId","idempotencyKey","points","reference","reason","actorId") VALUES ($1::uuid,$1::uuid,$2,$3,$4,$5,$1::uuid)',[uid,'probe-zero-point-redemption',0,'probe','probe reason'],'check constraint');
 // Verify concurrent transactions contend on the same customer advisory lock.
 // The second transaction must not enter its critical section before the first commits.
 const lockKey='retail-ci-loyalty-customer';
 let releaseFirst;
 let firstEntered;
 const firstReady=new Promise(resolve=>{firstEntered=resolve;});
 const firstRelease=new Promise(resolve=>{releaseFirst=resolve;});
 const events=[];
 const first=db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  events.push('first-acquired');firstEntered();await firstRelease;
  events.push('first-released');
 },{timeout:10000});
 await firstReady;
 const second=db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  events.push('second-acquired');
 },{timeout:10000});
 // Give PostgreSQL a chance to schedule the competing transaction.
 try {
  await db.$queryRawUnsafe('SELECT 1 AS tick FROM pg_sleep(0.15)');
  assert.deepEqual(events,['first-acquired'],'Concurrent transaction entered locked loyalty section');
 } finally {releaseFirst();}
 await Promise.all([first,second]);
 assert.deepEqual(events,['first-acquired','first-released','second-acquired'],'Advisory lock failed to serialize concurrent transactions');
 // Real migrated-table financial fixture: two settlements totaling more than one approved return.
 // The deliberately rejected transaction rolls back the location, order, return, and payout.
 const fixtureId=randomUUID(),orderId=randomUUID(),returnId=randomUUID(),actorId=randomUUID();
 await assert.rejects(db.$transaction(async tx=>{
  await tx.$executeRaw`INSERT INTO "Location" ("id","code","name","type","updatedAt") VALUES (${fixtureId}::uuid,${'ci-'+fixtureId},'CI temporary location','ONLINE'::"LocationType",CURRENT_TIMESTAMP)`;
  await tx.$executeRaw`INSERT INTO "OnlineOrder" ("id","orderNumber","idempotencyKey","requestHash","warehouseId","customerName","phone","address","city","paymentMethod","status","subtotal","total","updatedAt") VALUES (${orderId}::uuid,${'ci-'+orderId},${'ci-'+orderId},'ci',${fixtureId}::uuid,'CI Customer','0000000000','CI','CI','COD'::"OnlinePaymentMethod",'DELIVERED'::"OnlineOrderStatus",100,100,CURRENT_TIMESTAMP)`;
  await tx.$executeRaw`INSERT INTO "OnlineReturn" ("id","orderId","idempotencyKey","reason","approvedById","merchandiseAmount") VALUES (${returnId}::uuid,${orderId}::uuid,${'ci-'+returnId},'CI financial fixture',${actorId}::uuid,100)`;
  await tx.$executeRaw`INSERT INTO "OnlineRefundSettlement" ("id","returnId","idempotencyKey","method","amount","reference","settledById") VALUES (${randomUUID()}::uuid,${returnId}::uuid,${'ci-first-'+returnId},'CASH',60,'CI-REF-1',${actorId}::uuid)`;
  await tx.$executeRaw`INSERT INTO "OnlineRefundSettlement" ("id","returnId","idempotencyKey","method","amount","reference","settledById") VALUES (${randomUUID()}::uuid,${returnId}::uuid,${'ci-second-'+returnId},'CASH',50,'CI-REF-2',${actorId}::uuid)`;
 }),e=>{assert(String(e.message).includes('Online refund exceeds approved merchandise amount'),'Online refund cap must reject cumulative overpayment');return true;});
 assert.equal(await db.onlineReturn.count({where:{id:returnId}}),0,'Financial fixture must roll back completely');
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
