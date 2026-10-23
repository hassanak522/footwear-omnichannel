import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, ForbiddenException, ConflictException } from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { Db } from './db';
import { TransfersService } from './transfers';
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
 constructor(private db:Db,private transfers:TransfersService){}
 @Get('sources') async sources(@CurrentUser() u:Principal){return this.db.location.findMany({where:{active:true,type:{in:['WAREHOUSE','BRANCH']},...(u.roles.includes('SUPER_ADMIN')?{}:{id:{notIn:u.locations}})},select:{id:true,name:true,type:true}});}
 @Get('requests') list(@CurrentUser() u:Principal){return this.db.replenishmentRequest.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{OR:[{destinationId:{in:u.locations}},{sourceId:{in:u.locations}}]},orderBy:{createdAt:'desc'},take:200});}
 @Post('requests') @Roles('SUPER_ADMIN','BRANCH_MANAGER') async create(@Body() d:RequestDto,@CurrentUser() u:Principal){
  assertLocation(u,d.destinationId);if(d.sourceId===d.destinationId)throw new BadRequestException('Choose another source');
  const [src,dst]=await Promise.all([this.db.location.findUniqueOrThrow({where:{id:d.sourceId}}),this.db.location.findUniqueOrThrow({where:{id:d.destinationId}})]);
  if(!src.active||!dst.active||dst.type!=='BRANCH'||!['BRANCH','WAREHOUSE'].includes(src.type))throw new BadRequestException('Invalid locations');
  return this.db.replenishmentRequest.create({data:{...d,requestedById:u.id}});
 }
 // One stable transfer key per request makes retries safe and prevents duplicate transfer creation.
 @Post('requests/:id/create-transfer') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') async createTransfer(@Param('id') id:string,@CurrentUser() u:Principal){
  const r=await this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});
  assertLocation(u,r.sourceId);
  if(r.status!=='APPROVED')throw new ConflictException('Approve the request before creating a transfer');
  return this.transfers.create({sourceId:r.sourceId,destinationId:r.destinationId,items:[{variantId:r.variantId,quantity:r.quantity}],idempotencyKey:`replenishment:${r.id}:transfer`},u);
 }
 @Post('requests/:id/reject') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') async reject(@Param('id') id:string,@CurrentUser() u:Principal){
  const r=await this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});assertLocation(u,r.sourceId);
  const changed=await this.db.replenishmentRequest.updateMany({where:{id,status:'REQUESTED'},data:{status:'REJECTED',reviewedAt:new Date()}});
  if(changed.count!==1)throw new ConflictException('Request already reviewed');
  return this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});
 }
 // Approval records intent only. Physical stock must move through the existing audited transfer workflow.
 @Post('requests/:id/approve') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') async approve(@Param('id') id:string,@CurrentUser() u:Principal){
  const r=await this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});assertLocation(u,r.sourceId);
  const changed=await this.db.replenishmentRequest.updateMany({where:{id,status:'REQUESTED'},data:{status:'APPROVED',reviewedAt:new Date()}});
  if(changed.count!==1)throw new ConflictException('Request already reviewed');
  return this.db.replenishmentRequest.findUniqueOrThrow({where:{id}});
 }
}
