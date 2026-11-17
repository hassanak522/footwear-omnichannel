import { randomUUID } from 'node:crypto';
import { Controller, Get, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { Db } from './db';
import { JwtAuthGuard, Roles, RolesGuard } from './auth';

class PeriodQuery {
 @IsOptional() @IsDateString() from?: string;
 @IsOptional() @IsDateString() to?: string;
 @IsOptional() @IsUUID() locationId?: string;
}

@Controller('hq')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class HqController {
 constructor(private readonly db: Db) {}
 private period(q: PeriodQuery) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86400000);
  if (!(from < to) || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Invalid period (maximum 366 days; to is exclusive)');
  return { from, to };
 }
 @Get('overview')
 async overview(@Query() q: PeriodQuery) {
  const {from,to}=this.period(q);
  const locationFilter=q.locationId?{locationId:q.locationId}:{};
  const [locations,balances,accepted,conflicts,openShifts,transfers,returns] = await Promise.all([
   this.db.location.findMany({where:q.locationId?{id:q.locationId}:{},select:{id:true,code:true,name:true,type:true,active:true}}),
   this.db.stockBalance.findMany({where:locationFilter,select:{locationId:true,onHand:true,reservedOnline:true,reservedReplenish:true,quarantined:true,safetyBuffer:true}}),
   this.db.posSale.aggregate({where:{...locationFilter,status:'ACCEPTED',soldAt:{gte:from,lt:to}},_count:{_all:true},_sum:{total:true}}),
   this.db.posSale.count({where:{...locationFilter,status:'STOCK_CONFLICT',soldAt:{gte:from,lt:to}}}),
   this.db.posShift.count({where:{...locationFilter,status:'OPEN'}}),
   this.db.stockTransfer.count({where:{status:'DISPATCHED',...(q.locationId?{OR:[{sourceId:q.locationId},{destinationId:q.locationId}]}:{})}}),
   this.db.posReturn.aggregate({where:{...(q.locationId?{locationId:q.locationId}:{}),createdAt:{gte:from,lt:to}},_count:{_all:true}}),
  ]);
  const stock=balances.reduce((a,b)=>{a.onHand+=b.onHand;a.reservedOnline+=b.reservedOnline;a.reservedReplenish+=b.reservedReplenish;a.quarantined+=b.quarantined;a.safetyBuffer+=b.safetyBuffer;return a;},{onHand:0,reservedOnline:0,reservedReplenish:0,quarantined:0,safetyBuffer:0});
  return {period:{from,to,timezone:'UTC',toExclusive:true},locations,stock:{...stock,available:stock.onHand-stock.reservedOnline-stock.reservedReplenish-stock.quarantined-stock.safetyBuffer},pos:{acceptedSales:accepted._count._all,grossAcceptedSales:accepted._sum.total?.toString()??'0',stockConflicts:conflicts,openShifts,approvedReturnCount:returns._count._all},transfers:{inTransit:transfers},notes:['POS sales use soldAt, not sync time. Offline sales not yet synced are excluded.','Gross accepted sales are not net revenue: returns, refunds, taxes, and payment settlement are not deducted.','Stock is a current snapshot, not an as-of-period stock balance.']};
 }

 @Post('stock-availability-snapshots')
 async captureStockAvailability() {
  const batchId = randomUUID();
  const capturedAt = new Date();

  const balances = await this.db.stockBalance.findMany({
   where: {
    location: {
     type: 'BRANCH',
     active: true
    }
   },
   select: {
    locationId: true,
    variantId: true,
    onHand: true,
    quarantined: true,
    reservedOnline: true,
    reservedReplenish: true,
    safetyBuffer: true
   }
  });

  if (balances.length === 0) {
   throw new BadRequestException(
    'No active branch stock balances available for capture'
   );
  }

  const records = balances.map(b => {
   const available = Math.max(
    0,
    b.onHand -
    b.quarantined -
    b.reservedOnline -
    b.reservedReplenish -
    b.safetyBuffer
   );

   return {
    batchId,
    capturedAt,
    locationId: b.locationId,
    variantId: b.variantId,
    onHand: b.onHand,
    quarantined: b.quarantined,
    reservedOnline: b.reservedOnline,
    reservedReplenish: b.reservedReplenish,
    safetyBuffer: b.safetyBuffer,
    available
   };
  });

  const result =
   await this.db.stockAvailabilitySnapshot.createMany({
    data: records
   });

  if (result.count !== records.length) {
   throw new BadRequestException(
    'Snapshot capture count mismatch'
   );
  }

  return {
   success: true,
   batchId,
   capturedAt: capturedAt.toISOString(),
   capturedRows: result.count,
   note:
    'Snapshot recorded successfully. ' +
    'Inventory balances were not modified.'
  };
 }

 @Get('stock-availability-snapshots')
 async stockAvailabilityHistory() {
  const batches =
   await this.db.stockAvailabilitySnapshot.groupBy({
    by: ['batchId', 'capturedAt'],
    _count: {
     _all: true
    },
    orderBy: {
     capturedAt: 'desc'
    },
    take: 30
   });

  const batchIds = batches.map(b => b.batchId);

  const [snapshots, locations] = await Promise.all([
   batchIds.length > 0
    ? this.db.stockAvailabilitySnapshot.findMany({
       where: {
        batchId: {
         in: batchIds
        }
       },
       select: {
        batchId: true,
        locationId: true,
        variantId: true,
        capturedAt: true,
        available: true
       }
      })
    : Promise.resolve([]),

   this.db.location.findMany({
    where: {
     type: 'BRANCH'
    },
    select: {
     id: true,
     name: true
    }
   })
  ]);

  const locationNames = new Map(
   locations.map(l => [l.id, l.name])
  );

  return {
   batches: batches.map(b => ({
    batchId: b.batchId,
    capturedAt: b.capturedAt,
    rows: b._count._all
   })),

   rows: snapshots.map(s => ({
    batchId: s.batchId,
    locationId: s.locationId,
    variantId: s.variantId,
    branchName:
     locationNames.get(s.locationId) || s.locationId,
    capturedAt: s.capturedAt,
    available: s.available
   })),

   notes: [
    'Snapshots represent inventory at a recorded instant.',
    'Zero availability is confirmed only at capture time.',
    'Stockout duration cannot be inferred between captures.',
    'The most recent 30 snapshot batches are returned.',
    'Historical records do not change stock balances.'
   ]
  };
 }
 @Get('pos-forecast-accuracy')
 async posForecastAccuracy(@Query() q:PeriodQuery) {
  const {from,to}=this.period(q);
  const duration=(to.getTime()-from.getTime())/86400000;

  if(duration<14 || duration>90){
   throw new BadRequestException(
    'Forecast analysis requires 14 to 90 days'
   );
  }

  const sales=await this.db.posSale.findMany({
   where:{
    status:'ACCEPTED',
    soldAt:{gte:from,lt:to},
    location:{
     type:'BRANCH',
     active:true
    },
    ...(q.locationId?{locationId:q.locationId}:{})
   },
   select:{
    locationId:true,
    soldAt:true,
    lines:{
     select:{variantId:true,quantity:true}
    }
   },
   orderBy:{soldAt:'asc'},
   take:10001
  });

  if(sales.length>10000){
   throw new BadRequestException(
    'More than 10000 accepted sales in this period. '+
    'Use a shorter date range; partial results are not returned.'
   );
  }

  const balances=await this.db.stockBalance.findMany({
   where:{
    location:{
     type:'BRANCH',
     active:true,
     ...(q.locationId?{id:q.locationId}:{})
    }
   },
   select:{
    locationId:true,variantId:true,
    onHand:true,quarantined:true,
    reservedOnline:true,reservedReplenish:true,
    safetyBuffer:true,
    location:{select:{name:true}},
    variant:{select:{sku:true}}
   }
  });

  const split=from.getTime()+
   (to.getTime()-from.getTime())*0.7;
  const trainDays=(split-from.getTime())/86400000;
  const testDays=(to.getTime()-split)/86400000;
  const recentStart=to.getTime()-7*86400000;
  const previousStart=to.getTime()-14*86400000;

  const demand=new Map<string,{
   train:number;test:number;
   recent:number;previous:number;
  }>();

  for(const sale of sales){
   const time=sale.soldAt.getTime();

   for(const line of sale.lines){
    const key=sale.locationId+':'+line.variantId;
    const current=demand.get(key)||{
     train:0,test:0,recent:0,previous:0
    };

    if(time<split)current.train+=line.quantity;
    else current.test+=line.quantity;

    if(time>=recentStart)current.recent+=line.quantity;
    else if(time>=previousStart)
     current.previous+=line.quantity;

    demand.set(key,current);
   }
  }

  const rows=balances.map(b=>{
   const key=b.locationId+':'+b.variantId;
   const d=demand.get(key)||{
    train:0,test:0,recent:0,previous:0
   };

   const available=Math.max(0,
    b.onHand-b.quarantined-b.reservedOnline-
    b.reservedReplenish-b.safetyBuffer
   );

   const historicalDaily=d.train/trainDays;
   const predictedTest=historicalDaily*testDays;
   const recentDaily=d.recent/7;
   const previousDaily=d.previous/7;
   const daysCover=recentDaily>0
    ?available/recentDaily:null;

   const risk=recentDaily===0?'INSUFFICIENT SIGNAL':
    available===0?'OUT OF STOCK NOW':
    daysCover!==null && daysCover<=3?'CRITICAL':
    daysCover!==null && daysCover<=7?'HIGH':'NORMAL';

   return {
    locationId:b.locationId,
    branchName:b.location.name,
    variantId:b.variantId,
    sku:b.variant.sku,
    available,
    trainingUnits:d.train,
    testUnits:d.test,
    predictedTestUnits:predictedTest,
    absoluteError:Math.abs(predictedTest-d.test),
    historicalDaily,
    recentDaily,
    previousDaily,
    velocityChangePct:previousDaily>0
     ?(recentDaily-previousDaily)*100/previousDaily
     :null,
    daysCover,
    risk,
    accuracyEligible:d.train>0 && d.test>0
   };
  });

  const eligible=rows.filter(r=>r.accuracyEligible);
  const actual=eligible.reduce((n,r)=>n+r.testUnits,0);
  const error=eligible.reduce((n,r)=>n+r.absoluteError,0);

  return {
   period:{from,to,trainDays,testDays},
   saleCount:sales.length,
   rows,
   accuracy:{
    eligibleSkuBranches:eligible.length,
    wapePct:actual>0?100*error/actual:null,
    definition:'Sum absolute errors / sum actual units'
   },
   notes:[
    'Only accepted, synchronized POS sales are included.',
    'Forecast uses the first 70% of the period to predict the final 30%.',
    'WAPE is calculated only for SKU/branch pairs with positive training and test sales.',
    'Velocity compares the latest 7 days against the preceding 7 days.',
    'Stockout risk uses current available stock and recent sales; it does not reconstruct historical stockouts.',
    'Sales are gross units and are not adjusted for returns.',
    'Zero sales may reflect stockouts, inactivity, or insufficient demand.',
    'Analysis is limited to 10000 accepted sales; larger requests fail rather than return incomplete metrics.'
   ]
  };
 }
 @Get('pos-demand-forecast')
 async posDemandForecast(@Query() q:PeriodQuery) {
  const {from,to} = this.period(q);
  const days = (to.getTime()-from.getTime())/86400000;

  const [locations,grouped,balances] = await Promise.all([
   this.db.location.findMany({
    where:{
     type:'BRANCH',
     active:true,
     ...(q.locationId?{id:q.locationId}:{})
    },
    select:{id:true,name:true,code:true}
   }),
   this.db.posSaleLine.groupBy({
    by:['variantId','saleId'],
    where:{
     sale:{
      status:'ACCEPTED',
      soldAt:{gte:from,lt:to},
      ...(q.locationId?{locationId:q.locationId}:{})
     }
    },
    _sum:{quantity:true}
   }),
   this.db.stockBalance.findMany({
    where:{
     location:{
      type:'BRANCH',
      active:true,
      ...(q.locationId?{id:q.locationId}:{})
     }
    },
    select:{
     locationId:true,variantId:true,onHand:true,
     quarantined:true,reservedOnline:true,
     reservedReplenish:true,safetyBuffer:true,
     variant:{select:{sku:true}}
    }
   })
  ]);

  const saleIds = [...new Set(grouped.map(g=>g.saleId))];
  const sales = saleIds.length
   ? await this.db.posSale.findMany({
      where:{id:{in:saleIds}},
      select:{id:true,locationId:true}
     })
   : [];

  const saleLocations = new Map(
   sales.map(s=>[s.id,s.locationId])
  );

  const demand = new Map<string,number>();

  for(const g of grouped){
   const locationId=saleLocations.get(g.saleId);
   if(!locationId)continue;
   const key=locationId+':'+g.variantId;
   demand.set(key,(demand.get(key)||0)+(g._sum.quantity||0));
  }

  const stockKeys = new Set(
   balances.map(b=>b.locationId+':'+b.variantId)
  );

  return {
   period:{from,to,days,timezone:'UTC',toExclusive:true},
   locations,
   rows:balances.map(b=>{
    const units=demand.get(b.locationId+':'+b.variantId)||0;
    const available=Math.max(0,
     b.onHand-b.quarantined-b.reservedOnline-
     b.reservedReplenish-b.safetyBuffer
    );
    return {
     locationId:b.locationId,
     variantId:b.variantId,
     sku:b.variant.sku,
     soldUnits:units,
     averageDailySales:units/days,
     available,
     hasStockBalance:true
    };
   }),
   soldWithoutBalance:[...demand.entries()]
    .filter(([key])=>!stockKeys.has(key))
    .map(([key,units])=>({key,units})),
   notes:[
    'Accepted POS sales only; unsynced offline sales are excluded.',
    'Demand is gross sales, not adjusted for returns.',
    'Average daily sales includes zero-sale days in the period.',
    'Only branch/SKU combinations with stock balances appear in rows.',
    'Available inventory is a current snapshot, not historical stock.',
    'No-sales does not prove zero demand: stockouts may suppress sales.'
   ]
  };
 }
 @Get('sales-analytics')
 async salesAnalytics(@Query() q:PeriodQuery){
  const {from,to}=this.period(q);
  const where={...(q.locationId?{locationId:q.locationId}:{}),soldAt:{gte:from,lt:to}};
  const sales=await this.db.posSale.findMany({where,select:{id:true,locationId:true,status:true,total:true,soldAt:true,tenders:{select:{type:true,amount:true}}},orderBy:{soldAt:'desc'},take:5000});
  const grouped=new Map<string,{locationId:string;acceptedSales:number;stockConflicts:number;gross:number;cash:number;card:number}>();
  for(const sale of sales){
   const row=grouped.get(sale.locationId)||{locationId:sale.locationId,acceptedSales:0,stockConflicts:0,gross:0,cash:0,card:0};
   if(sale.status==='ACCEPTED'){
    row.acceptedSales++;row.gross+=sale.total.toNumber();
    for(const t of sale.tenders){if(t.type==='CASH')row.cash+=t.amount.toNumber();if(t.type==='CARD')row.card+=t.amount.toNumber();}
   }else if(sale.status==='STOCK_CONFLICT')row.stockConflicts++;
   grouped.set(sale.locationId,row);
  }
  return {period:{from,to,toExclusive:true},byLocation:[...grouped.values()].map(x=>({...x,gross:x.gross.toFixed(2),cash:x.cash.toFixed(2),card:x.card.toFixed(2)})),returned:sales.length,truncated:sales.length===5000,note:'Accepted POS gross totals only; refunds, tax and card settlement are not netted. Maximum 5000 sales per query; narrow the period if truncated.'};
 }
 @Get('stock-by-location')
 async stockByLocation(@Query('locationId') locationId?:string){
  if(locationId && !/^[0-9a-f-]{36}$/i.test(locationId))throw new BadRequestException('Invalid locationId');
  const balances=await this.db.stockBalance.findMany({where:locationId?{locationId}:{},include:{location:{select:{code:true,name:true,type:true}},variant:{select:{sku:true}}},orderBy:[{locationId:'asc'},{variantId:'asc'}]});
  return balances.map(b=>({locationId:b.locationId,location:b.location.name,locationCode:b.location.code,locationType:b.location.type,variantId:b.variantId,sku:b.variant.sku,onHand:b.onHand,reservedOnline:b.reservedOnline,reservedReplenish:b.reservedReplenish,quarantined:b.quarantined,safetyBuffer:b.safetyBuffer,available:b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer,version:b.version}));
 }
 @Get('attention')
 async attention(){
  const [balances,shifts,conflicts,transfers]=await Promise.all([
   this.db.stockBalance.findMany({include:{location:{select:{code:true}},variant:{select:{sku:true}}}}),
   this.db.posShift.findMany({where:{status:'OPEN'},select:{id:true,locationId:true,deviceId:true,openedAt:true},orderBy:{openedAt:'asc'},take:100}),
   this.db.posSale.findMany({where:{status:'STOCK_CONFLICT'},select:{id:true,locationId:true,deviceId:true,localSaleId:true,conflictReason:true,syncedAt:true},orderBy:{syncedAt:'desc'},take:100}),
   this.db.stockTransfer.findMany({where:{status:'DISPATCHED'},select:{id:true,transferNumber:true,sourceId:true,destinationId:true,dispatchedAt:true},orderBy:{dispatchedAt:'asc'},take:100})
  ]);
  return {lowAvailability:balances.filter(b=>b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer<=b.safetyBuffer).map(b=>({locationId:b.locationId,locationCode:b.location.code,variantId:b.variantId,sku:b.variant.sku,onHand:b.onHand,available:b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer,safetyBuffer:b.safetyBuffer})),openShifts:shifts,stockConflicts:conflicts,inTransitTransfers:transfers,limits:{openShifts:100,stockConflicts:100,inTransitTransfers:100},notes:'Attention lists are operational indicators; no automated correction or financial reconciliation is performed.'};
 }
}
