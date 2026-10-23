import { createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PosTenderType, Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class RegisterDeviceDto {
 @IsString() @Matches(/^[A-Z0-9_-]{3,50}$/) code!: string;
 @IsUUID() locationId!: string;
}
class OpenShiftDto {
 @IsUUID() deviceId!: string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) openingCash!: number;
}
class CloseShiftDto {
 @IsNumber({maxDecimalPlaces:2}) @Min(0) closingCash!: number;
}
class SaleLineDto {
 @IsUUID() variantId!: string;
 @IsInt() @Min(1) quantity!: number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) unitPrice!: number;
}
class SaleTenderDto {
 @IsEnum(PosTenderType) type!: PosTenderType;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) amount!: number;
 @IsOptional() @IsString() @MaxLength(100) reference?: string;
}
class ReturnLineDto {
 @IsUUID() variantId!: string;
 @IsInt() @Min(1) quantity!: number;
 @IsOptional() @IsBoolean() quarantined?: boolean;
}
class ReturnDto {
 @IsUUID() saleId!: string;
 @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!: string;
 @IsString() @MinLength(3) @MaxLength(500) reason!: string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>ReturnLineDto) lines!: ReturnLineDto[];
}
class SyncSaleDto {
 @IsUUID() deviceId!: string;
 @IsUUID() localSaleId!: string;
 @IsUUID() shiftId!: string;
 @IsDateString() soldAt!: string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SaleLineDto) lines!: SaleLineDto[];
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SaleTenderDto) tenders!: SaleTenderDto[];
}
const money=(v:number)=>new Prisma.Decimal(v.toFixed(2));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

@Injectable()
export class PosService {
 constructor(private db:Db){}
 private branchAccess(u:Principal,id:string){assertLocation(u,id);}
 async registerDevice(dto:RegisterDeviceDto,u:Principal){
  this.branchAccess(u,dto.locationId);
  const location=await this.db.location.findUnique({where:{id:dto.locationId}});
  if(!location||location.type!=='BRANCH'||!location.active)throw new BadRequestException('Active branch required');
  return this.db.posDevice.create({data:{code:dto.code,locationId:dto.locationId}});
 }
 async openShift(dto:OpenShiftDto,u:Principal){
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:dto.deviceId}});
  this.branchAccess(u,device.locationId);
  if(!device.active)throw new ForbiddenException('Device disabled');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-shift:${dto.deviceId}`}))`;
   const active=await tx.posShift.findFirst({where:{deviceId:dto.deviceId,status:'OPEN'}});
   if(active)throw new ConflictException('Device already has an open shift');
   return tx.posShift.create({data:{deviceId:dto.deviceId,locationId:device.locationId,cashierId:u.id,openingCash:money(dto.openingCash)}});
  });
 }
 async closeShift(id:string,dto:CloseShiftDto,u:Principal){
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-shift-id:${id}`}))`;
   const shift=await tx.posShift.findUniqueOrThrow({where:{id}});
   this.branchAccess(u,shift.locationId);
   if(shift.cashierId!==u.id&&!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Not shift owner');
   if(shift.status!=='OPEN')throw new ConflictException('Shift already closed');
   // Reject known server-side conflicts; the desktop must also sync local sales first.
   // Unsynced local sales cannot be proven absent without a device checkpoint protocol.
   const conflicted=await tx.posSale.count({where:{shiftId:id,status:'STOCK_CONFLICT'}});
   if(conflicted>0)throw new ConflictException(`Cannot close shift with ${conflicted} unresolved stock-conflict sale(s)`);
   return tx.posShift.update({where:{id},data:{status:'CLOSED',closedAt:new Date(),closingCash:money(dto.closingCash)}});
  });
 }
 async syncSale(dto:SyncSaleDto,u:Principal){
  if(new Set(dto.lines.map(x=>x.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variant lines: aggregate quantities before sync');
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:dto.deviceId}});
  this.branchAccess(u,device.locationId);
  if(!device.active)throw new ForbiddenException('Device disabled');
  const payloadHash=hash(dto);
  const expectedTotal=dto.lines.reduce((sum,l)=>sum+Math.round(l.unitPrice*100)*l.quantity,0);
  const paidTotal=dto.tenders.reduce((sum,t)=>sum+Math.round(t.amount*100),0);
  if(expectedTotal!==paidTotal)throw new BadRequestException('Tender amounts must equal sale total');
  if(new Date(dto.soldAt).getTime()>Date.now()+5*60_000)throw new BadRequestException('Sale timestamp is in the future');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-sale:${dto.deviceId}:${dto.localSaleId}`}))`;
   const existing=await tx.posSale.findUnique({where:{deviceId_localSaleId:{deviceId:dto.deviceId,localSaleId:dto.localSaleId}}});
   if(existing){
    if(existing.payloadHash!==payloadHash)throw new ConflictException('Local sale ID reused with different payload');
    return {id:existing.id,localSaleId:existing.localSaleId,status:existing.status,conflictReason:existing.conflictReason,duplicate:true};
   }
   // Existing local sales may sync after shift close. The shift must still belong to this device.
   const shift=await tx.posShift.findUniqueOrThrow({where:{id:dto.shiftId}});
   if(shift.deviceId!==dto.deviceId||shift.locationId!==device.locationId)throw new BadRequestException('Shift does not belong to this device');
   if(shift.cashierId!==u.id&&!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Not shift owner');
   if(new Date(dto.soldAt)<shift.openedAt || (shift.closedAt && new Date(dto.soldAt)>shift.closedAt))throw new BadRequestException('Sale time outside shift');
   let conflictReason:string|undefined;
   const balances:{variantId:string;id:string;onHand:number;reservedOnline:number;reservedReplenish:number;quarantined:number;safetyBuffer:number}[]=[];
   for(const line of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${device.locationId+':'+line.variantId}))`;
    const variant=await tx.productVariant.findUnique({where:{id:line.variantId}});
    if(!variant||!variant.active)throw new BadRequestException(`Unknown or inactive variant ${line.variantId}`);
    const balance=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:device.locationId,variantId:line.variantId}},create:{locationId:device.locationId,variantId:line.variantId},update:{}});
    balances.push({...balance});
    if(balance.onHand-balance.reservedOnline-balance.reservedReplenish-balance.quarantined-balance.safetyBuffer<line.quantity){
     conflictReason=`Insufficient sellable branch stock for variant ${line.variantId}`;
     break;
    }
   }
   const sale=await tx.posSale.create({data:{deviceId:dto.deviceId,localSaleId:dto.localSaleId,payloadHash,locationId:device.locationId,shiftId:dto.shiftId,cashierId:shift.cashierId,status:conflictReason?'STOCK_CONFLICT':'ACCEPTED',conflictReason,soldAt:new Date(dto.soldAt),total:new Prisma.Decimal(expectedTotal).div(100),lines:{create:dto.lines.map(l=>({variantId:l.variantId,quantity:l.quantity,unitPrice:money(l.unitPrice)}))},tenders:{create:dto.tenders.map(t=>({type:t.type,amount:money(t.amount),reference:t.reference}))}}});
   if(!conflictReason){
    for(const line of dto.lines){
     const balance=balances.find(b=>b.variantId===line.variantId)!;
     await tx.stockBalance.update({where:{id:balance.id},data:{onHand:{decrement:line.quantity},version:{increment:1}}});
     await tx.stockMovement.create({data:{locationId:device.locationId,variantId:line.variantId,type:'SALE',quantityDelta:-line.quantity,referenceType:'POS_SALE',referenceId:sale.id,idempotencyKey:`pos:${sale.id}:${line.variantId}`,actorId:shift.cashierId}});
    }
   }
   await tx.auditLog.create({data:{actorId:u.id,action:conflictReason?'POS_STOCK_CONFLICT':'POS_SALE_SYNC',entityType:'PosSale',entityId:sale.id,after:{status:sale.status,deviceId:dto.deviceId,localSaleId:dto.localSaleId}}});
   return {id:sale.id,localSaleId:sale.localSaleId,status:sale.status,conflictReason:sale.conflictReason,duplicate:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
 async returnSale(dto:ReturnDto,u:Principal){
  if(new Set(dto.lines.map(x=>x.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate return variants');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-return:${dto.saleId}`}))`;
   const existing=await tx.posReturn.findUnique({where:{idempotencyKey:dto.idempotencyKey},include:{lines:true}});
   if(existing){
    const requested=[...dto.lines].map(l=>({variantId:l.variantId,quantity:l.quantity,quarantined:l.quarantined===true})).sort((a,b)=>a.variantId.localeCompare(b.variantId));
    const recorded=existing.lines.map(l=>({variantId:l.variantId,quantity:l.quantity,quarantined:l.quarantined})).sort((a,b)=>a.variantId.localeCompare(b.variantId));
    if(existing.saleId!==dto.saleId||existing.reason!==dto.reason||JSON.stringify(requested)!==JSON.stringify(recorded))throw new ConflictException('Return idempotency key reused with different request');
    this.branchAccess(u,existing.locationId);
    return existing;
   }
   const sale=await tx.posSale.findUnique({where:{id:dto.saleId},include:{lines:true,returns:{include:{lines:true}}}});
   if(!sale||sale.status!=='ACCEPTED')throw new BadRequestException('Accepted original sale required');
   this.branchAccess(u,sale.locationId);
   const records=[];
   for(const line of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const sold=sale.lines.find(l=>l.variantId===line.variantId);
    if(!sold)throw new BadRequestException('Variant not in original sale');
    const previouslyReturned=sale.returns.flatMap(r=>r.lines).filter(l=>l.variantId===line.variantId).reduce((n,l)=>n+l.quantity,0);
    if(line.quantity>sold.quantity-previouslyReturned)throw new ConflictException('Return exceeds unreturned quantity');
    records.push({variantId:line.variantId,quantity:line.quantity,quarantined:line.quarantined===true,refundAmount:sold.unitPrice.mul(line.quantity)});
   }
   const ret=await tx.posReturn.create({data:{saleId:sale.id,locationId:sale.locationId,idempotencyKey:dto.idempotencyKey,reason:dto.reason,approvedById:u.id,lines:{create:records}},include:{lines:true}});
   for(const line of records){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sale.locationId+':'+line.variantId}))`;
    await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:sale.locationId,variantId:line.variantId}},create:{locationId:sale.locationId,variantId:line.variantId,onHand:line.quantity,quarantined:line.quarantined?line.quantity:0},update:{onHand:{increment:line.quantity},...(line.quarantined?{quarantined:{increment:line.quantity}}:{}),version:{increment:1}}});
    await tx.stockMovement.create({data:{locationId:sale.locationId,variantId:line.variantId,type:'SALE_RETURN',quantityDelta:line.quantity,referenceType:'POS_RETURN',referenceId:ret.id,idempotencyKey:`pos-return:${ret.id}:${line.variantId}`,actorId:u.id}});
   }
   await tx.auditLog.create({data:{actorId:u.id,action:'POS_RETURN_APPROVED',entityType:'PosReturn',entityId:ret.id,after:{saleId:sale.id,reason:dto.reason,lines:records.map(x=>({variantId:x.variantId,quantity:x.quantity,quarantined:x.quarantined,refundAmount:x.refundAmount.toString()}))}}});
   return ret;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
 async shiftSummary(id:string,u:Principal){
  const shift=await this.db.posShift.findUniqueOrThrow({where:{id},include:{sales:{include:{tenders:true}}}});
  this.branchAccess(u,shift.locationId);
  const accepted=shift.sales.filter(s=>s.status==='ACCEPTED');
  const cash=accepted.flatMap(s=>s.tenders).filter(t=>t.type==='CASH').reduce((sum,t)=>sum+t.amount.toNumber(),0);
  const card=accepted.flatMap(s=>s.tenders).filter(t=>t.type==='CARD').reduce((sum,t)=>sum+t.amount.toNumber(),0);
  return {shiftId:id,status:shift.status,openingCash:shift.openingCash,closingCash:shift.closingCash,acceptedSales:accepted.length,conflictedSales:shift.sales.length-accepted.length,cashSales:cash,cardSales:card,expectedCash:shift.openingCash.toNumber()+cash,variance:shift.closingCash===null?null:shift.closingCash.toNumber()-shift.openingCash.toNumber()-cash};
 }
 async deviceStatus(deviceId:string,u:Principal){
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:deviceId},include:{location:{select:{name:true,code:true,active:true}}}});
  this.branchAccess(u,device.locationId);
  const shift=await this.db.posShift.findFirst({where:{deviceId,status:'OPEN'},orderBy:{openedAt:'desc'},select:{id:true,openedAt:true,cashierId:true,openingCash:true}});
  return {id:device.id,code:device.code,active:device.active,locationId:device.locationId,location:device.location,openShift:shift};
 }
 async listSales(locationId:string,u:Principal){this.branchAccess(u,locationId);return this.db.posSale.findMany({where:{locationId},orderBy:{syncedAt:'desc'},take:100,include:{lines:true,tenders:true}});}
}
@Controller('pos') @UseGuards(JwtAuthGuard,RolesGuard)
export class PosController {
 constructor(private pos:PosService){}
 @Get('devices/:id/status') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') deviceStatus(@Param('id') id:string,@CurrentUser() u:Principal){return this.pos.deviceStatus(id,u);}
 @Post('devices') @Roles('SUPER_ADMIN','BRANCH_MANAGER') register(@Body() dto:RegisterDeviceDto,@CurrentUser() u:Principal){return this.pos.registerDevice(dto,u);}
 @Post('shifts/open') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') open(@Body() dto:OpenShiftDto,@CurrentUser() u:Principal){return this.pos.openShift(dto,u);}
 @Post('shifts/:id/close') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') close(@Param('id') id:string,@Body() dto:CloseShiftDto,@CurrentUser() u:Principal){return this.pos.closeShift(id,dto,u);}
 @Post('sales/sync') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') sync(@Body() dto:SyncSaleDto,@CurrentUser() u:Principal){return this.pos.syncSale(dto,u);}
 @Post('returns') @Roles('SUPER_ADMIN','BRANCH_MANAGER') returnSale(@Body() dto:ReturnDto,@CurrentUser() u:Principal){return this.pos.returnSale(dto,u);}
 @Get('shifts/:id/summary') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') summary(@Param('id') id:string,@CurrentUser() u:Principal){return this.pos.shiftSummary(id,u);}
 @Get('sales/:locationId') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') list(@Param('locationId') id:string,@CurrentUser() u:Principal){return this.pos.listSales(id,u);}
}
