import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { Db } from './db';
import { Prisma } from '@prisma/client';
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
 @Get('refund-reconciliation')
 async refundReconciliation(@Query() q:PeriodQuery){
  const {from,to}=this.period(q);
  const range={gte:from,lt:to};
  const [posReturns,onlineReturns,posPayouts,onlinePayouts]=await Promise.all([
   this.db.posReturn.findMany({where:{createdAt:range,...(q.locationId?{locationId:q.locationId}:{})},select:{id:true,locationId:true,createdAt:true,lines:{select:{refundAmount:true}}},take:5001,orderBy:{createdAt:'desc'}}),
   this.db.onlineReturn.findMany({where:{createdAt:range,...(q.locationId?{order:{warehouseId:q.locationId}}:{})},select:{id:true,createdAt:true,merchandiseAmount:true,order:{select:{warehouseId:true}}},take:5001,orderBy:{createdAt:'desc'}}),
   this.db.posRefundSettlement.findMany({where:{settledAt:range,...(q.locationId?{return:{locationId:q.locationId}}:{})},select:{id:true,returnId:true,amount:true,method:true,settledAt:true},take:5001,orderBy:{settledAt:'desc'}}),
   this.db.onlineRefundSettlement.findMany({where:{settledAt:range,...(q.locationId?{return:{order:{warehouseId:q.locationId}}}:{})},select:{id:true,returnId:true,amount:true,method:true,settledAt:true},take:5001,orderBy:{settledAt:'desc'}})
  ]);
  const amount=(items:{amount:Prisma.Decimal}[])=>items.reduce((sum,x)=>sum.plus(x.amount),new Prisma.Decimal(0)).toString();
  const posApproved=posReturns.reduce((sum,r)=>sum.plus(r.lines.reduce((n,l)=>n.plus(l.refundAmount),new Prisma.Decimal(0))),new Prisma.Decimal(0));
  const onlineApproved=onlineReturns.reduce((sum,r)=>sum.plus(r.merchandiseAmount),new Prisma.Decimal(0));
  return {period:{from:from.toISOString(),to:to.toISOString()},currency:'PKR',pos:{returns:posReturns.length,approvedMerchandise:posApproved.toString(),payouts:posPayouts.length,paidInPeriod:amount(posPayouts)},online:{returns:onlineReturns.length,approvedMerchandise:onlineApproved.toString(),payouts:onlinePayouts.length,paidInPeriod:amount(onlinePayouts)},byMethod:Object.entries([...posPayouts,...onlinePayouts].reduce((acc,p)=>{const k=p.method;acc[k]=(acc[k]??new Prisma.Decimal(0)).plus(p.amount);return acc;},{} as Record<string,Prisma.Decimal>)).map(([method,total])=>({method,paid:total.toString()})),truncated:[posReturns,onlineReturns,posPayouts,onlinePayouts].some(x=>x.length>5000),note:'Approved return amounts use approval dates; paid amounts use settlement dates. They are different cohorts and must not be subtracted to calculate outstanding balances. No money movement is initiated.'};
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
