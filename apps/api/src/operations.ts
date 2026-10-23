import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { Db } from './db';
import { JwtAuthGuard, Roles, RolesGuard } from './auth';
class Filter {
 @IsOptional() @IsUUID() locationId?:string;
 @IsOptional() @IsUUID() variantId?:string;
 @IsOptional() @IsDateString() from?:string;
 @IsOptional() @IsDateString() to?:string;
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(500) limit?:number;
}
@Controller('operations')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN')
export class OperationsController {
 constructor(private readonly db:Db){}
 private dates(q:Filter){
  const to=q.to?new Date(q.to):new Date();const from=q.from?new Date(q.from):new Date(to.getTime()-30*86400000);
  if(!(from<to)||to.getTime()-from.getTime()>366*86400000)throw new BadRequestException('Invalid date range; to exclusive, max 366 days');
  return {gte:from,lt:to};
 }
 @Get('stock-ledger') async stockLedger(@Query() q:Filter){
  const rows=await this.db.stockMovement.findMany({where:{...(q.locationId?{locationId:q.locationId}:{}),...(q.variantId?{variantId:q.variantId}:{}),createdAt:this.dates(q)},include:{location:{select:{code:true,name:true}},variant:{select:{sku:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit??200});
  return rows.map(x=>({id:x.id,date:x.createdAt,branch:x.location.code,sku:x.variant.sku,type:x.type,quantityDelta:x.quantityDelta,referenceType:x.referenceType,referenceId:x.referenceId,notes:x.notes,actorId:x.actorId}));
 }
 @Get('sales-ledger') async salesLedger(@Query() q:Filter){
  const rows=await this.db.posSale.findMany({where:{...(q.locationId?{locationId:q.locationId}:{}),soldAt:this.dates(q)},include:{location:{select:{code:true}},device:{select:{code:true}},lines:{include:{variant:{select:{sku:true}}}},tenders:true},orderBy:[{soldAt:'desc'},{id:'desc'}],take:q.limit??200});
  return rows.map(s=>({id:s.id,localSaleId:s.localSaleId,soldAt:s.soldAt,branch:s.location.code,terminal:s.device.code,status:s.status,total:s.total.toString(),lines:s.lines.map(l=>({sku:l.variant.sku,quantity:l.quantity,unitPrice:l.unitPrice.toString()})),tenders:s.tenders.map(t=>({type:t.type,amount:t.amount.toString(),reference:t.reference})),conflictReason:s.conflictReason}));
 }
 @Get('shift-ledger') async shiftLedger(@Query() q:Filter){
  const rows=await this.db.posShift.findMany({where:{...(q.locationId?{locationId:q.locationId}:{}),openedAt:this.dates(q)},include:{location:{select:{code:true}},device:{select:{code:true}},cashier:{select:{name:true}},sales:{select:{status:true,total:true,tenders:{select:{type:true,amount:true}}}}},orderBy:{openedAt:'desc'},take:q.limit??200});
  return rows.map(s=>{const accepted=s.sales.filter(x=>x.status==='ACCEPTED');const cash=accepted.flatMap(x=>x.tenders).filter(x=>x.type==='CASH').reduce((n,x)=>n+x.amount.toNumber(),0);const card=accepted.flatMap(x=>x.tenders).filter(x=>x.type==='CARD').reduce((n,x)=>n+x.amount.toNumber(),0);const expected=s.openingCash.toNumber()+cash;return {id:s.id,branch:s.location.code,terminal:s.device.code,cashier:s.cashier.name,status:s.status,openedAt:s.openedAt,closedAt:s.closedAt,openingCash:s.openingCash.toString(),cashSales:cash.toFixed(2),cardSales:card.toFixed(2),acceptedSales:accepted.length,stockConflicts:s.sales.length-accepted.length,expectedCash:expected.toFixed(2),countedCash:s.closingCash?.toString()??null,variance:s.closingCash===null?null:(s.closingCash.toNumber()-expected).toFixed(2)};});
 }
 @Get('returns-ledger') async returnsLedger(@Query() q:Filter){
  const rows=await this.db.posReturn.findMany({where:{...(q.locationId?{locationId:q.locationId}:{}),createdAt:this.dates(q)},include:{location:{select:{code:true}},lines:true},orderBy:{createdAt:'desc'},take:q.limit??200});
  return rows.map(r=>({id:r.id,saleId:r.saleId,branch:r.location.code,date:r.createdAt,reason:r.reason,approvedById:r.approvedById,quantity:r.lines.reduce((n,l)=>n+l.quantity,0),refundAmount:r.lines.reduce((n,l)=>n+l.refundAmount.toNumber(),0).toFixed(2),quarantinedQuantity:r.lines.filter(l=>l.quarantined).reduce((n,l)=>n+l.quantity,0)}));
 }
 @Get('inventory-health') async inventoryHealth(@Query() q:Filter){
  const rows=await this.db.stockBalance.findMany({where:{...(q.locationId?{locationId:q.locationId}:{}),...(q.variantId?{variantId:q.variantId}:{})},include:{location:{select:{code:true,name:true,type:true}},variant:{select:{sku:true,price:true,cost:true}}},orderBy:[{locationId:'asc'},{variantId:'asc'}],take:5000});
  return {rows:rows.map(b=>{const sellable=b.onHand-b.quarantined-b.reservedOnline-b.reservedReplenish-b.safetyBuffer;return {branch:b.location.code,locationId:b.locationId,locationType:b.location.type,sku:b.variant.sku,variantId:b.variantId,onHand:b.onHand,quarantined:b.quarantined,reservedOnline:b.reservedOnline,reservedReplenish:b.reservedReplenish,safetyBuffer:b.safetyBuffer,sellable,needsAttention:sellable<=0||b.quarantined>0,stockValueAtCost:b.variant.cost?b.variant.cost.mul(b.onHand).toString():null};}),truncated:rows.length===5000,note:'Current stock snapshot; value at cost is informational and not an accounting valuation.'};
 }
 @Get('audit-ledger') async auditLedger(@Query() q:Filter){
  const rows=await this.db.auditLog.findMany({where:{createdAt:this.dates(q)},orderBy:{createdAt:'desc'},take:q.limit??200});
  return rows.map(x=>({id:x.id,createdAt:x.createdAt,actorId:x.actorId,action:x.action,entityType:x.entityType,entityId:x.entityId,before:x.before,after:x.after}));
 }
}
