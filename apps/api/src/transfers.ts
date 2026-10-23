import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, IsUUID, Min, MinLength, ValidateNested } from 'class-validator';
import { Prisma, TransferStatus } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class TransferLine { @IsUUID() variantId!: string; @IsInt() @Min(1) quantity!: number; }
class CreateTransferDto {
 @IsUUID() sourceId!: string; @IsUUID() destinationId!: string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>TransferLine) items!: TransferLine[];
 @IsString() @MinLength(8) idempotencyKey!: string;
}
class ActionDto { @IsString() @MinLength(8) idempotencyKey!: string; }
class ReceiptLine { @IsUUID() variantId!: string; @IsInt() @Min(0) receivedQty!: number; @IsInt() @Min(0) damagedQty!: number; }
class ReceiveDto extends ActionDto { @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>ReceiptLine) items!: ReceiptLine[]; }

@Injectable()
export class TransfersService {
 constructor(private db: Db) {}
 private requireRole(u:Principal,...roles:string[]){if(!u.roles.includes('SUPER_ADMIN')&&!roles.some(r=>u.roles.includes(r)))throw new ForbiddenException('Insufficient role');}
 private access(u:Principal,locationId:string){assertLocation(u,locationId);}
 private async lockedTransfer(tx:Prisma.TransactionClient,id:string){
  await tx.$queryRaw`SELECT id FROM "StockTransfer" WHERE id = ${id}::uuid FOR UPDATE`;
  const transfer=await tx.stockTransfer.findUnique({where:{id},include:{items:true}});
  if(!transfer)throw new BadRequestException('Transfer not found');
  return transfer;
 }
 private async lockBalance(tx:Prisma.TransactionClient,locationId:string,variantId:string){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${locationId+':'+variantId}))`;
  return tx.stockBalance.upsert({where:{locationId_variantId:{locationId,variantId}},create:{locationId,variantId},update:{}});
 }
 private async once(tx:Prisma.TransactionClient,key:string,action:string,transferId:string,payload:unknown){
  const prior=await tx.integrationEvent.findUnique({where:{idempotencyKey:key}});
  if(prior){if(prior.source!==`TRANSFER_${action}` || JSON.stringify(prior.payload)!==JSON.stringify({transferId,payload}))throw new ConflictException('Idempotency key reused');return true;}
  return false;
 }
 private async event(tx:Prisma.TransactionClient,key:string,action:string,transferId:string,payload:unknown){
  await tx.integrationEvent.create({data:{source:`TRANSFER_${action}`,eventType:action,idempotencyKey:key,payload:JSON.parse(JSON.stringify({transferId,payload})),processedAt:new Date()}});
 }
 private async audit(tx:Prisma.TransactionClient,u:Principal,action:string,id:string,before:unknown,after:unknown){
  await tx.auditLog.create({data:{actorId:u.id,action,entityType:'StockTransfer',entityId:id,before:before as Prisma.InputJsonValue,after:after as Prisma.InputJsonValue}});
 }
 async create(dto:CreateTransferDto,u:Principal){
  this.requireRole(u,'BRANCH_MANAGER','WAREHOUSE_MANAGER');this.access(u,dto.sourceId); // Destination is an approved location, not necessarily assigned to the requester.
  if(dto.sourceId===dto.destinationId)throw new BadRequestException('Source and destination must differ');
  if(new Set(dto.items.map(i=>i.variantId)).size!==dto.items.length)throw new BadRequestException('Duplicate variants');
  return this.db.$transaction(async tx=>{
   const prior=await tx.integrationEvent.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(prior){if(prior.source!=='TRANSFER_CREATE'||JSON.stringify(prior.payload)!==JSON.stringify(dto))throw new ConflictException('Idempotency key reused');return tx.stockTransfer.findUniqueOrThrow({where:{id:(prior.eventType)},include:{items:true}});}
   const locations=await tx.location.findMany({where:{id:{in:[dto.sourceId,dto.destinationId]},active:true}});
   if(locations.length!==2 || !locations.some(l=>l.id===dto.sourceId&&['WAREHOUSE','BRANCH'].includes(l.type)) || !locations.some(l=>l.id===dto.destinationId&&['BRANCH','ONLINE'].includes(l.type)))throw new BadRequestException('Only active warehouse/branch to branch/online transfers are supported');
   const variants=await tx.productVariant.count({where:{id:{in:dto.items.map(i=>i.variantId)},active:true}});
   if(variants!==dto.items.length)throw new BadRequestException('Unknown or inactive variant');
   const transfer=await tx.stockTransfer.create({data:{transferNumber:`TR-${randomUUID()}`,sourceId:dto.sourceId,destinationId:dto.destinationId,items:{create:dto.items.map(i=>({variantId:i.variantId,requestedQty:i.quantity}))}},include:{items:true}});
   await tx.integrationEvent.create({data:{source:'TRANSFER_CREATE',eventType:transfer.id,idempotencyKey:dto.idempotencyKey,payload:JSON.parse(JSON.stringify(dto)),processedAt:new Date()}});
   await this.audit(tx,u,'TRANSFER_REQUEST',transfer.id,{}, {status:'REQUESTED'});
   return transfer;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async approve(id:string,dto:ActionDto,u:Principal){
  this.requireRole(u,'WAREHOUSE_MANAGER','BRANCH_MANAGER');
  return this.db.$transaction(async tx=>{
   const t=await this.lockedTransfer(tx,id);this.access(u,t.sourceId);
   if(await this.once(tx,dto.idempotencyKey,'APPROVE',id,{}))return t;
   if(t.status!=='REQUESTED')throw new ConflictException('Transfer must be requested');
   for(const item of [...t.items].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const b=await this.lockBalance(tx,t.sourceId,item.variantId);
    if(b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer<item.requestedQty)throw new ConflictException(`Insufficient stock for ${item.variantId}`);
    await tx.stockBalance.update({where:{id:b.id},data:{reservedReplenish:{increment:item.requestedQty},version:{increment:1}}});
   }
   const result=await tx.stockTransfer.update({where:{id},data:{status:'APPROVED'},include:{items:true}});
   await this.event(tx,dto.idempotencyKey,'APPROVE',id,{});await this.audit(tx,u,'TRANSFER_APPROVE',id,{status:t.status},{status:result.status});return result;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async dispatch(id:string,dto:ActionDto,u:Principal){
  this.requireRole(u,'WAREHOUSE_MANAGER','BRANCH_MANAGER');
  return this.db.$transaction(async tx=>{
   const t=await this.lockedTransfer(tx,id);this.access(u,t.sourceId);
   if(await this.once(tx,dto.idempotencyKey,'DISPATCH',id,{}))return t;
   if(t.status!=='APPROVED')throw new ConflictException('Transfer must be approved');
   for(const item of [...t.items].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const b=await this.lockBalance(tx,t.sourceId,item.variantId);
    if(b.onHand<item.requestedQty||b.reservedReplenish<item.requestedQty)throw new ConflictException('Reserved stock mismatch');
    await tx.stockBalance.update({where:{id:b.id},data:{onHand:{decrement:item.requestedQty},reservedReplenish:{decrement:item.requestedQty},version:{increment:1}}});
    await tx.stockTransferItem.update({where:{id:item.id},data:{dispatchedQty:item.requestedQty}});
    await tx.stockMovement.create({data:{locationId:t.sourceId,variantId:item.variantId,type:'TRANSFER_DISPATCH',quantityDelta:-item.requestedQty,referenceType:'STOCK_TRANSFER',referenceId:id,idempotencyKey:`transfer:${id}:dispatch:${item.variantId}`,actorId:u.id}});
   }
   const result=await tx.stockTransfer.update({where:{id},data:{status:'DISPATCHED',dispatchedAt:new Date()},include:{items:true}});
   await this.event(tx,dto.idempotencyKey,'DISPATCH',id,{});await this.audit(tx,u,'TRANSFER_DISPATCH',id,{status:t.status},{status:result.status});return result;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async receive(id:string,dto:ReceiveDto,u:Principal){
  this.requireRole(u,'BRANCH_MANAGER','WAREHOUSE_MANAGER');
  return this.db.$transaction(async tx=>{
   const t=await this.lockedTransfer(tx,id);this.access(u,t.destinationId);
   if(await this.once(tx,dto.idempotencyKey,'RECEIVE',id,dto.items))return t;
   if(t.status!=='DISPATCHED')throw new ConflictException('Transfer must be dispatched');
   if(dto.items.length!==t.items.length||new Set(dto.items.map(i=>i.variantId)).size!==dto.items.length)throw new BadRequestException('Provide one receipt line for each dispatched variant');
   const expected=new Map(t.items.map(i=>[i.variantId,i]));
   for(const line of dto.items){const item=expected.get(line.variantId);if(!item||line.receivedQty+line.damagedQty>item.dispatchedQty)throw new BadRequestException('Invalid receipt quantities');}
   let variance=false;
   for(const line of [...dto.items].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const item=expected.get(line.variantId)!;
    const b=await this.lockBalance(tx,t.destinationId,line.variantId);
    if(line.receivedQty+line.damagedQty!==item.dispatchedQty)variance=true;
    await tx.stockBalance.update({where:{id:b.id},data:{onHand:{increment:line.receivedQty+line.damagedQty},quarantined:{increment:line.damagedQty},version:{increment:1}}});
    await tx.stockTransferItem.update({where:{id:item.id},data:{receivedQty:line.receivedQty,damagedQty:line.damagedQty}});
    if(line.receivedQty+line.damagedQty>0)await tx.stockMovement.create({data:{locationId:t.destinationId,variantId:line.variantId,type:'TRANSFER_RECEIPT',quantityDelta:line.receivedQty+line.damagedQty,referenceType:'STOCK_TRANSFER',referenceId:id,idempotencyKey:`transfer:${id}:receive:${line.variantId}`,actorId:u.id,metadata:{damagedQty:line.damagedQty}}});
   }
   const status:TransferStatus=variance?'PARTIALLY_RECEIVED':'RECEIVED';
   const result=await tx.stockTransfer.update({where:{id},data:{status,receivedAt:new Date()},include:{items:true}});
   await this.event(tx,dto.idempotencyKey,'RECEIVE',id,dto.items);await this.audit(tx,u,'TRANSFER_RECEIVE',id,{status:t.status},{status,variance});return result;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async list(u:Principal){return this.db.stockTransfer.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{OR:[{sourceId:{in:u.locations}},{destinationId:{in:u.locations}}]},include:{items:true},orderBy:{createdAt:'desc'},take:200});}
 async get(id:string,u:Principal){const t=await this.db.stockTransfer.findUnique({where:{id},include:{items:true,source:true,destination:true}});if(!t)throw new BadRequestException('Transfer not found');if(!u.roles.includes('SUPER_ADMIN')&&!u.locations.some(l=>l===t.sourceId||l===t.destinationId))throw new ForbiddenException();return t;}
}
@Controller('transfers') @UseGuards(JwtAuthGuard,RolesGuard)
export class TransfersController {
 constructor(private svc:TransfersService){}
 @Post() @Roles('SUPER_ADMIN','BRANCH_MANAGER','WAREHOUSE_MANAGER') create(@Body() dto:CreateTransferDto,@CurrentUser() u:Principal){return this.svc.create(dto,u);}
 @Get() list(@CurrentUser() u:Principal){return this.svc.list(u);}
 @Get(':id') get(@Param('id') id:string,@CurrentUser() u:Principal){return this.svc.get(id,u);}
 @Post(':id/approve') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER') approve(@Param('id') id:string,@Body() dto:ActionDto,@CurrentUser() u:Principal){return this.svc.approve(id,dto,u);}
 @Post(':id/dispatch') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER') dispatch(@Param('id') id:string,@Body() dto:ActionDto,@CurrentUser() u:Principal){return this.svc.dispatch(id,dto,u);}
 @Post(':id/receive') @Roles('SUPER_ADMIN','BRANCH_MANAGER','WAREHOUSE_MANAGER') receive(@Param('id') id:string,@Body() dto:ReceiveDto,@CurrentUser() u:Principal){return this.svc.receive(id,dto,u);}
}
