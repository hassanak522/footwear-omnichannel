import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Prisma, ReservationPurpose } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';
class AdjustDto { @IsUUID() locationId!:string; @IsUUID() variantId!:string; @IsInt() delta!:number; @IsString() @MinLength(8) idempotencyKey!:string; @IsString() @MinLength(3) reason!:string; }
class ReserveDto { @IsUUID() locationId!:string; @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsEnum(ReservationPurpose) purpose!:ReservationPurpose; @IsString() @MinLength(3) referenceId!:string; @IsString() @MinLength(8) idempotencyKey!:string; }
class ReleaseDto { @IsString() @MinLength(8) idempotencyKey!:string; }
@Injectable()
export class InventoryService {
 constructor(private db:Db){}
 async adjust(dto:AdjustDto,actor:Principal){
  assertLocation(actor,dto.locationId);
  return this.db.$transaction(async tx=>{
   const existing=await tx.stockMovement.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(existing){if(existing.referenceType!=='MANUAL_ADJUSTMENT' || existing.locationId!==dto.locationId || existing.variantId!==dto.variantId || existing.quantityDelta!==dto.delta)throw new ConflictException('Idempotency key reused with different request');return existing;}
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.locationId + ':' + dto.variantId}))`;
   const balance=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:dto.locationId,variantId:dto.variantId}},create:{locationId:dto.locationId,variantId:dto.variantId},update:{}});
   const next=balance.onHand+dto.delta;
   if(next<balance.reservedOnline+balance.reservedReplenish+balance.quarantined+balance.safetyBuffer)throw new ConflictException('Insufficient uncommitted stock');
   await tx.stockBalance.update({where:{id:balance.id},data:{onHand:next,version:{increment:1}}});
   const movement=await tx.stockMovement.create({data:{locationId:dto.locationId,variantId:dto.variantId,type:'ADJUSTMENT',quantityDelta:dto.delta,referenceType:'MANUAL_ADJUSTMENT',idempotencyKey:dto.idempotencyKey,actorId:actor.id,notes:dto.reason}});
   await tx.auditLog.create({data:{actorId:actor.id,action:'STOCK_ADJUST',entityType:'StockBalance',entityId:balance.id,before:{onHand:balance.onHand},after:{onHand:next,reason:dto.reason}}});
   return movement;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async reserve(dto:ReserveDto,actor:Principal){
  assertLocation(actor,dto.locationId);
  return this.db.$transaction(async tx=>{
   const prior=await tx.integrationEvent.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(prior){if(prior.source!=='INVENTORY_RESERVE' || JSON.stringify(prior.payload)!==JSON.stringify(dto))throw new ConflictException('Idempotency key reused');return tx.stockReservation.findFirstOrThrow({where:{referenceId:dto.referenceId,locationId:dto.locationId,variantId:dto.variantId,purpose:dto.purpose}});}
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.locationId + ':' + dto.variantId}))`;
   const location=await tx.location.findUniqueOrThrow({where:{id:dto.locationId}});
   if(dto.purpose==='ONLINE_ORDER' && location.type!=='WAREHOUSE')throw new BadRequestException('Online stock must be allocated from warehouse');
   const b=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:dto.locationId,variantId:dto.variantId}},create:{locationId:dto.locationId,variantId:dto.variantId},update:{}});
   if(b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer<dto.quantity)throw new ConflictException('Insufficient available stock');
   const reservation=await tx.stockReservation.create({data:{locationId:dto.locationId,variantId:dto.variantId,quantity:dto.quantity,purpose:dto.purpose,referenceId:dto.referenceId}});
   await tx.stockBalance.update({where:{id:b.id},data:{[dto.purpose==='ONLINE_ORDER'?'reservedOnline':'reservedReplenish']:{increment:dto.quantity},version:{increment:1}}});
   await tx.integrationEvent.create({data:{source:'INVENTORY_RESERVE',eventType:'CREATED',idempotencyKey:dto.idempotencyKey,payload:JSON.parse(JSON.stringify(dto)),processedAt:new Date()}});
   return reservation;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async release(id:string,dto:ReleaseDto,actor:Principal){
  return this.db.$transaction(async tx=>{
   const reservation=await tx.stockReservation.findUniqueOrThrow({where:{id}});assertLocation(actor,reservation.locationId);
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reservation.locationId + ':' + reservation.variantId}))`;
   const current=await tx.stockReservation.findUniqueOrThrow({where:{id}});
   if(current.status==='RELEASED')return current;
   if(current.status!=='ACTIVE')throw new ConflictException('Reservation not active');
   const prior=await tx.integrationEvent.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(prior)throw new ConflictException('Idempotency key already used');
   const result=await tx.stockReservation.update({where:{id},data:{status:'RELEASED'}});
   await tx.stockBalance.update({where:{locationId_variantId:{locationId:current.locationId,variantId:current.variantId}},data:{[current.purpose==='ONLINE_ORDER'?'reservedOnline':'reservedReplenish']:{decrement:current.quantity},version:{increment:1}}});
   await tx.integrationEvent.create({data:{source:'INVENTORY_RELEASE',eventType:'RELEASED',idempotencyKey:dto.idempotencyKey,payload:{reservationId:id},processedAt:new Date()}});
   return result;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
}
@Controller('inventory') @UseGuards(JwtAuthGuard,RolesGuard)
export class InventoryController {
 constructor(private db:Db,private inventory:InventoryService){}
 @Get('locations') locations(@CurrentUser() u:Principal){return this.db.location.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{id:{in:u.locations}}});}
 @Get('balances') async balances(@CurrentUser() u:Principal,@Query('locationId') locationId?:string){if(locationId)assertLocation(u,locationId);return this.db.stockBalance.findMany({where:{locationId:locationId?locationId:{in:u.roles.includes('SUPER_ADMIN')?(await this.db.location.findMany({select:{id:true}})).map(x=>x.id):u.locations}},include:{variant:true,location:true}});}
 @Get('branch-availability') async branchAvailability(@CurrentUser() u:Principal,@Query('locationId') locationId?:string){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  const loc=await this.db.location.findUniqueOrThrow({where:{id:locationId}});
  if(loc.type!=='BRANCH')throw new BadRequestException('Branch location required');
  const balances=await this.db.stockBalance.findMany({where:{locationId},include:{variant:{select:{sku:true,barcode:true}}},orderBy:{variantId:'asc'}});
  return balances.map(b=>({variantId:b.variantId,sku:b.variant.sku,barcode:b.variant.barcode,onHand:b.onHand,quarantined:b.quarantined,reservedOnline:b.reservedOnline,reservedReplenish:b.reservedReplenish,safetyBuffer:b.safetyBuffer,sellable:b.onHand-b.quarantined-b.reservedOnline-b.reservedReplenish-b.safetyBuffer,version:b.version}));
 }
 @Post('adjust') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER') adjust(@Body() dto:AdjustDto,@CurrentUser() u:Principal){return this.inventory.adjust(dto,u);}
 @Post('reserve') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','ECOMMERCE_MANAGER') reserve(@Body() dto:ReserveDto,@CurrentUser() u:Principal){return this.inventory.reserve(dto,u);}
 @Post('reservations/:id/release') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','ECOMMERCE_MANAGER') release(@Param('id') id:string,@Body() dto:ReleaseDto,@CurrentUser() u:Principal){return this.inventory.release(id,dto,u);}
}
