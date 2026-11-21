import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Get, Param, Post, Patch, Query, UseGuards, ForbiddenException, ConflictException } from '@nestjs/common';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
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
class CreateManagedStaffDto {
 @IsEmail() email!:string;
 @IsString() @MinLength(2) name!:string;
 @IsString() @MinLength(10) password!:string;
 @IsIn(['WAREHOUSE_MANAGER','BRANCH_MANAGER','CASHIER']) role!:string;
 @IsUUID() locationId!:string;
}
class UpdateManagedStaffDto {
 @IsOptional() @IsEmail() email?:string;
 @IsOptional() @IsString() @MinLength(2) name?:string;
 @IsOptional() @IsIn(['WAREHOUSE_MANAGER','BRANCH_MANAGER','CASHIER']) role?:string;
 @IsOptional() @IsUUID() locationId?:string;
 @IsOptional() @IsIn(['ACTIVE','DISABLED']) status?:'ACTIVE'|'DISABLED';
}
class ResetManagedPasswordDto {
 @IsString() @MinLength(10) password!:string;
}
@Controller('staff-management')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN')
export class StaffManagementController {
 constructor(private db:Db){}

 private readonly allowedRoles=[
  'WAREHOUSE_MANAGER',
  'BRANCH_MANAGER',
  'CASHIER'
 ];

 private async validateAssignment(role:string,locationId:string){
  if(!this.allowedRoles.includes(role)){
   throw new BadRequestException('Unsupported staff role');
  }

  const location=await this.db.location.findUnique({
   where:{id:locationId}
  });

  if(!location || !location.active){
   throw new BadRequestException('Invalid or inactive location');
  }

  const expectedType=role==='WAREHOUSE_MANAGER'
   ? 'WAREHOUSE'
   : 'BRANCH';

  if(location.type!==expectedType){
   throw new BadRequestException(
    `${role} requires a ${expectedType} location`
   );
  }

  const dbRole=await this.db.role.findUnique({
   where:{code:role}
  });

  if(!dbRole){
   throw new BadRequestException('Role not configured');
  }

  return dbRole;
 }

 private readonly select={
  id:true,
  email:true,
  name:true,
  status:true,
  roles:{select:{role:{select:{id:true,code:true,name:true}}}},
  locations:{select:{location:{select:{id:true,code:true,name:true,type:true}}}}
 } as const;

 @Get('users')
 list(){
  return this.db.user.findMany({
   select:this.select,
   orderBy:{name:'asc'}
  });
 }

 @Post('users')
 async create(
  @Body() dto:CreateManagedStaffDto,
  @CurrentUser() actor:Principal
 ){
  const email=dto.email.trim().toLowerCase();
  const name=dto.name.trim();

  if(name.length<2){
   throw new BadRequestException('Invalid staff name');
  }

  const role=await this.validateAssignment(
   dto.role,dto.locationId
  );

  const exists=await this.db.user.findUnique({
   where:{email}
  });

  if(exists){
   throw new ConflictException('Email already registered');
  }

  const passwordHash=await bcrypt.hash(dto.password,12);

  return this.db.$transaction(async tx=>{
   const user=await tx.user.create({
    data:{
     email,
     name,
     passwordHash,
     roles:{create:{roleId:role.id}},
     locations:{create:{locationId:dto.locationId}}
    },
    select:this.select
   });

   await tx.auditLog.create({
    data:{
     actorId:actor.id,
     action:'STAFF_CREATED',
     entityType:'User',
     entityId:user.id,
     after:{
      email,
      name,
      role:dto.role,
      locationId:dto.locationId
     }
    }
   });

   return user;
  });
 }

 @Patch('users/:id')
 async update(
  @Param('id') id:string,
  @Body() dto:UpdateManagedStaffDto,
  @CurrentUser() actor:Principal
 ){
  const existing=await this.db.user.findUnique({
   where:{id},
   include:{
    roles:{include:{role:true}},
    locations:true
   }
  });

  if(!existing){
   throw new BadRequestException('Staff account not found');
  }

  if(existing.roles.some(r=>r.role.code==='SUPER_ADMIN')){
   throw new ForbiddenException(
    'Super Administrator accounts require separate privileged management'
   );
  }

  if(
   (dto.role!==undefined || dto.locationId!==undefined) &&
   (existing.roles.length!==1 || existing.locations.length!==1)
  ){
   throw new ConflictException(
    'Multi-assignment accounts require dedicated access management'
   );
  }

  const currentRole=existing.roles[0]?.role.code;
  const currentLocation=existing.locations[0]?.locationId;

  const role=dto.role||currentRole;
  const locationId=dto.locationId||currentLocation;

  if(!role || !locationId){
   throw new BadRequestException('Role and location required');
  }

  const dbRole=await this.validateAssignment(role,locationId);

  const email=dto.email===undefined
   ? existing.email
   : dto.email.trim().toLowerCase();

  const name=dto.name===undefined
   ? existing.name
   : dto.name.trim();

  if(name.length<2){
   throw new BadRequestException('Invalid staff name');
  }

  if(email!==existing.email){
   const duplicate=await this.db.user.findUnique({
    where:{email}
   });

   if(duplicate){
    throw new ConflictException('Email already registered');
   }
  }

  return this.db.$transaction(async tx=>{
   await tx.user.update({
    where:{id},
    data:{
     email,
     name,
     ...(dto.status?{status:dto.status}:{})
    }
   });

   if(dto.role || dto.locationId){
    await tx.userRole.deleteMany({where:{userId:id}});
    await tx.userLocation.deleteMany({where:{userId:id}});

    await tx.userRole.create({
     data:{userId:id,roleId:dbRole.id}
    });

    await tx.userLocation.create({
     data:{userId:id,locationId}
    });
   }

   await tx.auditLog.create({
    data:{
     actorId:actor.id,
     action:'STAFF_UPDATED',
     entityType:'User',
     entityId:id,
     before:{
      email:existing.email,
      name:existing.name,
      status:existing.status,
      roles:existing.roles.map(r=>r.role.code),
      locations:existing.locations.map(l=>l.locationId)
     },
     after:{
      email,
      name,
      status:dto.status||existing.status,
      role,
      locationId
     }
    }
   });

   return tx.user.findUnique({
    where:{id},
    select:this.select
   });
  });
 }

 @Post('users/:id/reset-password')
 async resetPassword(
  @Param('id') id:string,
  @Body() dto:ResetManagedPasswordDto,
  @CurrentUser() actor:Principal
 ){
  const user=await this.db.user.findUnique({
   where:{id},
   include:{roles:{include:{role:true}}}
  });

  if(!user){
   throw new BadRequestException('Staff account not found');
  }

  if(user.roles.some(r=>r.role.code==='SUPER_ADMIN')){
   throw new ForbiddenException(
    'Super Administrator password reset requires separate authorization'
   );
  }

  const passwordHash=await bcrypt.hash(dto.password,12);

  await this.db.$transaction(async tx=>{
   await tx.user.update({
    where:{id},
    data:{passwordHash}
   });

   await tx.auditLog.create({
    data:{
     actorId:actor.id,
     action:'STAFF_PASSWORD_RESET',
     entityType:'User',
     entityId:id
    }
   });
  });

  return {success:true};
 }
}
class RequestDto { @IsUUID() sourceId!:string; @IsUUID() destinationId!:string; @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsOptional() @IsString() note?:string; }
@Controller('replenishment') @UseGuards(JwtAuthGuard,RolesGuard)
export class ReplenishmentController {
 constructor(private db:Db){}
 @Get('sources') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') async sources(@CurrentUser() u:Principal){return this.db.location.findMany({where:{active:true,type:{in:['WAREHOUSE','BRANCH']},...(u.roles.includes('SUPER_ADMIN')?{}:{id:{notIn:u.locations}})},select:{id:true,name:true,type:true}});}
 @Get('requests') @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER') list(@CurrentUser() u:Principal){return this.db.replenishmentRequest.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{OR:[{destinationId:{in:u.locations}},{sourceId:{in:u.locations}}]},orderBy:{createdAt:'desc'},take:200});}
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
   const locations=await tx.location.findMany({
    where:{
     id:{in:[r.sourceId,r.destinationId]},
     active:true
    }
   });

   if(locations.length!==2)
    throw new ConflictException(
     'Source or destination location is inactive'
    );

   if(!locations.some(l=>
     l.id===r.sourceId&&
     (l.type==='WAREHOUSE'||l.type==='BRANCH')
   ))
    throw new ConflictException('Invalid replenishment source');

   if(!locations.some(l=>
     l.id===r.destinationId&&l.type==='BRANCH'
   ))
    throw new ConflictException('Invalid replenishment destination');
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
 // R9_REPLENISHMENT_GOVERNANCE
 @Post('requests/:id/reject')
 @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER')
 async reject(@Param('id') id:string,@CurrentUser() u:Principal){
  return this.db.$transaction(async tx=>{
   const r=await tx.replenishmentRequest.findUniqueOrThrow({
    where:{id}
   });

   assertLocation(u,r.sourceId);

   const result=await tx.replenishmentRequest.updateMany({
    where:{id,status:'REQUESTED'},
    data:{status:'REJECTED',reviewedAt:new Date()}
   });

   if(result.count!==1)
    throw new ConflictException('Request already reviewed');

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'REPLENISHMENT_REJECTED',
     entityType:'ReplenishmentRequest',
     entityId:id,
     before:{status:r.status},
     after:{status:'REJECTED'}
    }
   });

   return tx.replenishmentRequest.findUniqueOrThrow({
    where:{id}
   });
  });
 }

 @Post('requests/:id/approve')
 @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER')
 async approve(@Param('id') id:string,@CurrentUser() u:Principal){
  return this.db.$transaction(async tx=>{
   const r=await tx.replenishmentRequest.findUniqueOrThrow({
    where:{id}
   });

   assertLocation(u,r.sourceId);

   const source=await tx.location.findUnique({
    where:{id:r.sourceId}
   });

   const destination=await tx.location.findUnique({
    where:{id:r.destinationId}
   });

   if(!source?.active||!destination?.active)
    throw new ConflictException('Replenishment location inactive');

   const result=await tx.replenishmentRequest.updateMany({
    where:{id,status:'REQUESTED'},
    data:{status:'APPROVED',reviewedAt:new Date()}
   });

   if(result.count!==1)
    throw new ConflictException('Request already reviewed');

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'REPLENISHMENT_APPROVED',
     entityType:'ReplenishmentRequest',
     entityId:id,
     before:{status:r.status},
     after:{
      status:'APPROVED',
      sourceId:r.sourceId,
      destinationId:r.destinationId,
      variantId:r.variantId,
      quantity:r.quantity
     }
    }
   });

   return tx.replenishmentRequest.findUniqueOrThrow({
    where:{id}
   });
  });
 }
}
