import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';

const db=new PrismaClient();
try {
 const requiredTables=['PosRefundSettlement','LoyaltyEntry','LoyaltyAdjustment','PosReturn','PosShift'];
 const tables=await db.$queryRawUnsafe('SELECT tablename FROM pg_tables WHERE schemaname = $1','public');
 const actual=new Set(tables.map(x=>x.tablename));
 for(const table of requiredTables)assert(actual.has(table),`Missing table: ${table}`);

 const constraints=await db.$queryRawUnsafe(`
  SELECT c.conname, t.relname AS table_name, pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname IN ('PosRefundSettlement','LoyaltyAdjustment')
 `);
 const has=(table,fragment)=>constraints.some(x=>x.table_name===table&&x.definition.includes(fragment));
 assert(constraints.some(x=>x.table_name==='PosRefundSettlement'&&/CHECK\s*\(/i.test(x.definition)&&/amount/i.test(x.definition)&&/>/.test(x.definition)),'Refund amount must be positive');
 assert(has('PosRefundSettlement','FOREIGN KEY ("payoutShiftId")'),'Payout shift FK missing');
 assert(constraints.some(x=>x.table_name==='LoyaltyAdjustment'&&/CHECK\s*\(/i.test(x.definition)&&/points/i.test(x.definition)&&/</.test(x.definition)),'Loyalty reversal must be negative');
 assert(has('LoyaltyAdjustment','FOREIGN KEY ("sourceEntryId")'),'Loyalty source FK missing');

 const indexes=await db.$queryRawUnsafe(`
 SELECT tablename,indexdef FROM pg_indexes WHERE schemaname='public'
 AND tablename IN ('PosRefundSettlement','LoyaltyAdjustment','LoyaltyEntry')
 `);
 for(const [table,column] of [['PosRefundSettlement','idempotencyKey'],['LoyaltyAdjustment','idempotencyKey'],['LoyaltyEntry','orderId']]){
  assert(indexes.some(x=>x.tablename===table&&x.indexdef.includes('UNIQUE')&&x.indexdef.includes('"'+column+'"')),`Missing unique index on ${table}.${column}`);
 }
 const shiftColumn=await db.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='PosRefundSettlement' AND column_name='payoutShiftId'`);
 assert.equal(shiftColumn.length,1,'Refund payout shift column missing');
 console.log('Retail finance database migrations and structural constraints verified.');
} finally {await db.$disconnect();}
