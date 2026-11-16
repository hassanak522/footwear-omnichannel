import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Prisma, ReservationPurpose, StockMovementType } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';
import { isDeepStrictEqual } from 'node:util';
class AdjustDto { @IsUUID() locationId!:string; @IsUUID() variantId!:string; @IsInt() delta!:number; @IsString() @MinLength(8) idempotencyKey!:string; @IsString() @MinLength(3) reason!:string; }
class ReserveDto { @IsUUID() locationId!:string; @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsEnum(ReservationPurpose) purpose!:ReservationPurpose; @IsString() @MinLength(3) referenceId!:string; @IsString() @MinLength(8) idempotencyKey!:string; }
class ReleaseDto { @IsString() @MinLength(8) idempotencyKey!:string; }

async function withInventoryTransactionRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const prismaCode =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code
          : 'NON_PRISMA_KNOWN_ERROR';

      console.error('[M109_DIAGNOSTIC]', {
        attempt,
        code: prismaCode,
        errorType: error instanceof Error ? error.name : typeof error,
      });

      const isRetryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034';

      if (!isRetryable) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new ConflictException(
          'Inventory is busy. Please retry the operation.',
        );
      }

      const backoffMs = Math.min(1600, 100 * Math.pow(2, attempt - 1));
      const jitterMs = Math.floor(Math.random() * 100);

      await new Promise<void>((resolve) =>
        setTimeout(resolve, backoffMs + jitterMs),
      );
    }
  }

  throw new ConflictException('Inventory transaction could not complete');
}

@Injectable()
export class InventoryService {
 constructor(private db:Db){}
 async adjust(dto:AdjustDto,actor:Principal){
  assertLocation(actor,dto.locationId);
   // R5-A2 ADJUSTMENT INTEGRITY
   if(!Number.isSafeInteger(dto.delta) || dto.delta===0)
    throw new BadRequestException('Adjustment quantity must be a non-zero safe integer');
   const reason=dto.reason?.trim();
   if(!reason || reason.length<3)
    throw new BadRequestException('Adjustment reason must contain at least 3 characters');
  return withInventoryTransactionRetry(() =>
    this.db.$transaction(async tx => {
   const existing=await tx.stockMovement.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(existing){if(existing.referenceType!=='MANUAL_ADJUSTMENT' || existing.locationId!==dto.locationId || existing.variantId!==dto.variantId || existing.quantityDelta!==dto.delta || existing.notes!==reason)throw new ConflictException('Idempotency key reused with different request');return existing;}
   // R5-B1B ACTIVE LOCATION GUARDS
   const adjustmentLocation=await tx.location.findUniqueOrThrow({where:{id:dto.locationId}});
   if(!adjustmentLocation.active)
    throw new BadRequestException('Cannot adjust stock at an inactive location');
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.locationId + ':' + dto.variantId}))`;
   const balance=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:dto.locationId,variantId:dto.variantId}},create:{locationId:dto.locationId,variantId:dto.variantId},update:{}});
   const next=balance.onHand+dto.delta;
   if(next<balance.reservedOnline+balance.reservedReplenish+balance.quarantined+balance.safetyBuffer)throw new ConflictException('Insufficient uncommitted stock');
   await tx.stockBalance.update({where:{id:balance.id},data:{onHand:next,version:{increment:1}}});
   const movement=await tx.stockMovement.create({data:{locationId:dto.locationId,variantId:dto.variantId,type:'ADJUSTMENT',quantityDelta:dto.delta,referenceType:'MANUAL_ADJUSTMENT',idempotencyKey:dto.idempotencyKey,actorId:actor.id,notes:reason}});
   await tx.auditLog.create({data:{actorId:actor.id,action:'STOCK_ADJUST',entityType:'StockBalance',entityId:balance.id,before:{onHand:balance.onHand},after:{onHand:next,reason:reason}}});
   return movement;
   }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000,
   }),
  );
 }
 async reserve(dto:ReserveDto,actor:Principal){
  assertLocation(actor,dto.locationId);
  return withInventoryTransactionRetry(() =>
   this.db.$transaction(async tx => {
   const prior=await tx.integrationEvent.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(prior){if(prior.source!=='INVENTORY_RESERVE' || !isDeepStrictEqual(prior.payload, JSON.parse(JSON.stringify(dto))))throw new ConflictException('Idempotency key reused');return tx.stockReservation.findFirstOrThrow({where:{referenceId:dto.referenceId,locationId:dto.locationId,variantId:dto.variantId,purpose:dto.purpose}});}
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dto.locationId + ':' + dto.variantId}))`;
   const location=await tx.location.findUniqueOrThrow({where:{id:dto.locationId}});
   if(!location.active)throw new BadRequestException('Cannot reserve stock at an inactive location');
    if(dto.purpose==='ONLINE_ORDER' && location.type!=='WAREHOUSE')throw new BadRequestException('Online stock must be allocated from warehouse');
   const b=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:dto.locationId,variantId:dto.variantId}},create:{locationId:dto.locationId,variantId:dto.variantId},update:{}});
   if(b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer<dto.quantity)throw new ConflictException('Insufficient available stock');
   const reservation=await tx.stockReservation.create({data:{locationId:dto.locationId,variantId:dto.variantId,quantity:dto.quantity,purpose:dto.purpose,referenceId:dto.referenceId}});
   await tx.stockBalance.update({where:{id:b.id},data:{[dto.purpose==='ONLINE_ORDER'?'reservedOnline':'reservedReplenish']:{increment:dto.quantity},version:{increment:1}}});
   await tx.integrationEvent.create({data:{source:'INVENTORY_RESERVE',eventType:'CREATED',idempotencyKey:dto.idempotencyKey,payload:JSON.parse(JSON.stringify(dto)),processedAt:new Date()}});
   return reservation;
   }, { 
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000,
   }),
  );
 }
 async release(id:string,dto:ReleaseDto,actor:Principal){
  return withInventoryTransactionRetry(() =>
   this.db.$transaction(async tx => {
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
   }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000,
   }),
  );
 }
}
@Controller('inventory') @UseGuards(JwtAuthGuard,RolesGuard)
export class InventoryController {
  // R5-B2A STOCK MOVEMENT HISTORY
  @Get('movements')
  @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER')
  async movements(
    @CurrentUser() u:Principal,
    @Query('locationId') locationId?:string,
    @Query('variantId') variantId?:string,
    @Query('sku') sku?:string,
    @Query('type') type?:string,
    @Query('from') from?:string,
    @Query('to') to?:string,
    @Query('page') pageRaw?:string,
    @Query('take') takeRaw?:string
  ){
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if(!locationId || !uuid.test(locationId))
      throw new BadRequestException('Valid locationId required');

    assertLocation(u,locationId);

    if(variantId && !uuid.test(variantId))
      throw new BadRequestException('Invalid variantId');

    const normalizedSku=sku?.trim();

    if(normalizedSku && normalizedSku.length>100)
      throw new BadRequestException('SKU too long');

    if(normalizedSku && variantId)
      throw new BadRequestException('Use either SKU or variantId');

    const allowedTypes=Object.values(StockMovementType);

    if(type && !allowedTypes.includes(type as StockMovementType))
      throw new BadRequestException('Invalid movement type');

    const page=pageRaw===undefined?1:Number(pageRaw);
    const take=takeRaw===undefined?50:Number(takeRaw);

    if(!Number.isSafeInteger(page) || page<1 ||
       !Number.isSafeInteger(take) || take<1 || take>100)
      throw new BadRequestException('Invalid pagination');

    const skip=(page-1)*take;

    if(!Number.isSafeInteger(skip))
      throw new BadRequestException('Pagination exceeds supported range');

    const fromDate=from===undefined?undefined:new Date(from);
    const toDate=to===undefined?undefined:new Date(to);

    if((fromDate && !Number.isFinite(fromDate.getTime())) ||
       (toDate && !Number.isFinite(toDate.getTime())))
      throw new BadRequestException('Invalid date range');

    if(fromDate && toDate && fromDate>toDate)
      throw new BadRequestException('From date must precede to date');

    const where:Prisma.StockMovementWhereInput={
      locationId,
      ...(variantId?{variantId}:{}),
      ...(normalizedSku?{variant:{sku:normalizedSku}}:{}),
      ...(type?{type:type as StockMovementType}:{}),
      ...((fromDate||toDate)?{
        createdAt:{
          ...(fromDate?{gte:fromDate}:{}),
          ...(toDate?{lte:toDate}:{})
        }
      }:{})
    };

    const [total,items]=await this.db.$transaction([
      this.db.stockMovement.count({where}),
      this.db.stockMovement.findMany({
        where,
        orderBy:[{createdAt:'desc'},{id:'desc'}],
        skip,
        take,
        select:{
          id:true,
          locationId:true,
          variantId:true,
          type:true,
          quantityDelta:true,
          referenceType:true,
          referenceId:true,
          actorId:true,
          notes:true,
          metadata:true,
          createdAt:true,
          variant:{
            select:{sku:true,barcode:true}
          },
          actor:{
            select:{name:true,email:true}
          }
        }
      })
    ]);

    return {
      locationId,
      page,
      take,
      total,
      totalPages:Math.ceil(total/take),
      items
    };
  }

 constructor(private db:Db,private inventory:InventoryService){}
 @Get('locations') locations(@CurrentUser() u:Principal){return this.db.location.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{id:{in:u.locations}}});}
 @Get('balances') async balances(@CurrentUser() u:Principal,@Query('locationId') locationId?:string){if(locationId)assertLocation(u,locationId);return this.db.stockBalance.findMany({where:{locationId:locationId?locationId:{in:u.roles.includes('SUPER_ADMIN')?(await this.db.location.findMany({select:{id:true}})).map(x=>x.id):u.locations}},include:{variant:true,location:true}});}
 @Get('branch-availability') async branchAvailability(@CurrentUser() u:Principal,@Query('locationId') locationId?:string){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  const loc=await this.db.location.findUniqueOrThrow({where:{id:locationId}});
  if(!loc.active)throw new BadRequestException('Branch location is inactive');
   if(loc.type!=='BRANCH')throw new BadRequestException('Branch location required');
  const balances=await this.db.stockBalance.findMany({where:{locationId},include:{variant:{select:{sku:true,barcode:true}}},orderBy:{variantId:'asc'}});
  return balances.map(b=>({variantId:b.variantId,sku:b.variant.sku,barcode:b.variant.barcode,onHand:b.onHand,quarantined:b.quarantined,reservedOnline:b.reservedOnline,reservedReplenish:b.reservedReplenish,safetyBuffer:b.safetyBuffer,sellable:b.onHand-b.quarantined-b.reservedOnline-b.reservedReplenish-b.safetyBuffer,version:b.version}));
 }
 @Post('adjust') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER') adjust(@Body() dto:AdjustDto,@CurrentUser() u:Principal){return this.inventory.adjust(dto,u);}
 @Post('reserve') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','ECOMMERCE_MANAGER') reserve(@Body() dto:ReserveDto,@CurrentUser() u:Principal){return this.inventory.reserve(dto,u);}
 @Post('reservations/:id/release') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','ECOMMERCE_MANAGER') release(@Param('id') id:string,@Body() dto:ReleaseDto,@CurrentUser() u:Principal){return this.inventory.release(id,dto,u);}
}
