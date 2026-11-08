import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, ForbiddenException, ConflictException } from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { Db } from './db';
import { CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard, assertLocation } from './auth';
class StaffDto { @IsEmail() email!:string; @IsString() @MinLength(2) name!:string; @IsString() @MinLength(10) password!:string; @IsUUID() locationId!:string; }
@Controller('staff') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('SUPER_ADMIN')
export class StaffController {
 constructor(private db:Db){}
 @Get('branch-users') list(){return this.db.user.findMany({where:{roles:{some:{role:{code:'BRANCH_MANAGER'}}}},select:{id:true,email:true,name:true,status:true,locations:{select:{location:{select:{id:true,name:true}}}}}});}
 @Post('branch-users') async create(@Body() d:StaffDto){
  const loc=await this.db.location.findUniqueOrThrow({where:{id:d.locationId}});
  if(loc.type!=='BRANCH')throw new BadRequestException('Branch required');
  const role=await this.db.role.findUniqueOrThrow({where:{code:'BRANCH_MANAGER'}});
  return this.db.user.create({data:{email:d.email.toLowerCase(),name:d.name,passwordHash:await bcrypt.hash(d.password,12),roles:{create:{roleId:role.id}},locations:{create:{locationId:d.locationId}}},select:{id:true,email:true,name:true}});
 }
}
class RequestDto { @IsUUID() sourceId!:string; @IsUUID() destinationId!:string; @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsOptional() @IsString() note?:string; }
@Controller('replenishment') @UseGuards(JwtAuthGuard,RolesGuard)
export class ReplenishmentController {
 constructor(private db:Db){}
 @Get('sources') async sources(@CurrentUser() u:Principal){return this.db.location.findMany({where:{active:true,type:{in:['WAREHOUSE','BRANCH']},...(u.roles.includes('SUPER_ADMIN')?{}:{id:{notIn:u.locations}})},select:{id:true,name:true,type:true}});}
 @Get('requests') list(@CurrentUser() u:Principal){return this.db.replenishmentRequest.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{OR:[{destinationId:{in:u.locations}},{sourceId:{in:u.locations}}]},orderBy:{createdAt:'desc'},take:200});}
 @Post('requests') @Roles('SUPER_ADMIN','BRANCH_MANAGER') async create(@Body() d:RequestDto,@CurrentUser() u:Principal){
  assertLocation(u,d.destinationId);if(d.sourceId===d.destinationId)throw new BadRequestException('Choose another source');
  const [src,dst]=await Promise.all([this.db.location.findUniqueOrThrow({where:{id:d.sourceId}}),this.db.location.findUniqueOrThrow({where:{id:d.destinationId}})]);
  if(!src.active||!dst.active||dst.type!=='BRANCH'||!['BRANCH','WAREHOUSE'].includes(src.type))throw new BadRequestException('Invalid locations');
  return this.db.replenishmentRequest.create({data:{...d,requestedById:u.id}});
 }
 // Atomic conversion: exactly one linked transfer for each approved request.
 @Post('requests/:id/create-transfer') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER')
 async createLinkedTransfer(@Param('id') id:string,@CurrentUser() u:Principal){
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "ReplenishmentRequest" WHERE id = ${id}::uuid FOR UPDATE`;
   const r=await tx.replenishmentRequest.findUniqueOrThrow({where:{id}});
   assertLocation(u,r.sourceId);
   if(r.status==='FULFILLED' || r.transferId)throw new ConflictException('Transfer already linked to request');
   if(r.status!=='APPROVED')throw new ConflictException('Request must be approved');
   const transfer=await tx.stockTransfer.create({data:{transferNumber:`TR-${randomUUID()}`,sourceId:r.sourceId,destinationId:r.destinationId,items:{create:[{variantId:r.variantId,requestedQty:r.quantity}]}},include:{items:true}});
   await tx.replenishmentRequest.update({where:{id},data:{transferId:transfer.id}});
   await tx.auditLog.create({data:{actorId:u.id,action:'REPLENISHMENT_TRANSFER_CREATED',entityType:'ReplenishmentRequest',entityId:id,after:{transferId:transfer.id}}});
   return {requestId:id,transfer};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 @Post('requests/:id/refresh-status') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER')
 async refreshStatus(@Param('id') id:string,@CurrentUser() u:Principal){
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "ReplenishmentRequest" WHERE id = ${id}::uuid FOR UPDATE`;
   const r=await tx.replenishmentRequest.findUniqueOrThrow({where:{id}});
   if(!u.roles.includes('SUPER_ADMIN')&&!u.locations.includes(r.sourceId)&&!u.locations.includes(r.destinationId))throw new ForbiddenException('Not assigned to either location');
   if(!r.transferId)throw new ConflictException('No linked transfer');
   const t=await tx.stockTransfer.findUniqueOrThrow({where:{id:r.transferId},include:{items:true}});
   if(t.status!=='RECEIVED')return {requestId:id,status:r.status,transferStatus:t.status};
   const line=t.items.find(i=>i.variantId===r.variantId);
   if(!line || line.receivedQty<r.quantity) return {requestId:id,status:r.status,transferStatus:t.status,receivedQty:line?.receivedQty??0};
   if(r.status!=='FULFILLED'){
    await tx.replenishmentRequest.update({where:{id},data:{status:'FULFILLED'}});
    await tx.auditLog.create({data:{actorId:u.id,action:'REPLENISHMENT_FULFILLED',entityType:'ReplenishmentRequest',entityId:id,after:{transferId:t.id}}});
   }
   return {requestId:id,status:'FULFILLED',transferStatus:t.status};
  });
 }
 @Post('requests/:id/reject') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') async reject(@Param('id') id:string,@CurrentUser() u:Principal){
  const r=await this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});assertLocation(u,r.sourceId);
  return this.db.replenishmentRequest.update({where:{id,status:'REQUESTED'},data:{status:'REJECTED',reviewedAt:new Date()}}).catch(()=>{throw new ConflictException('Request already reviewed');});
 }
 // Approval records intent only. Physical stock must move through the existing audited transfer workflow.
 @Post('requests/:id/approve') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') async approve(@Param('id') id:string,@CurrentUser() u:Principal){
  const r=await this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});assertLocation(u,r.sourceId);
  if(r.status!=='REQUESTED')throw new ConflictException('Already reviewed');
  return this.db.replenishmentRequest.update({where:{id,status:'REQUESTED'},data:{status:'APPROVED',reviewedAt:new Date()}}).catch(()=>{throw new ConflictException('Request already reviewed');});
 }
}
