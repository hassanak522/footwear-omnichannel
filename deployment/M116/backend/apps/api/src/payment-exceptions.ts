import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaymentEvidenceKind, PaymentExceptionStatus, Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class CreateCaseDto {
 @IsUUID() locationId!:string;
 @IsUUID() deviceId!:string;
 @IsUUID() localSaleId!:string;
 @IsOptional() @IsUUID() saleId?:string;
 @IsString() @MaxLength(1000) reason!:string;
 @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) expectedAmount?:number;
 @IsOptional() @IsNumber({maxDecimalPlaces:2}) @Min(0) observedAmount?:number;
}
class EvidenceDto {
 @IsEnum(PaymentEvidenceKind) kind!:PaymentEvidenceKind;
 @IsString() @MaxLength(200) reference!:string;
 @IsString() @MaxLength(1000) note!:string;
}
class ReviewDto {
 @IsEnum(PaymentExceptionStatus) status!:PaymentExceptionStatus;
 @IsString() @MaxLength(2000) note!:string;
}
@Controller('payment-exceptions')
@UseGuards(JwtAuthGuard,RolesGuard)
export class PaymentExceptionsController {
 constructor(private db:Db){}
 private manager(u:Principal){if(!u.roles.some(r=>r==='SUPER_ADMIN'||r==='BRANCH_MANAGER'))throw new ForbiddenException('Manager role required');}
 private async access(id:string,u:Principal){
  const item=await this.db.paymentException.findUniqueOrThrow({where:{id}});
  assertLocation(u,item.locationId);
  return item;
 }
 @Post() @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async create(@Body() d:CreateCaseDto,@CurrentUser() u:Principal){
  assertLocation(u,d.locationId);
  if(!d.reason.trim())throw new BadRequestException('Reason required');
  const device=await this.db.posDevice.findUnique({where:{id:d.deviceId}});
  if(!device||device.locationId!==d.locationId)throw new BadRequestException('Device does not belong to location');
  const sale=await this.db.posSale.findUnique({where:{deviceId_localSaleId:{deviceId:d.deviceId,localSaleId:d.localSaleId}}});
  if(d.saleId&&(!sale||sale.id!==d.saleId))throw new BadRequestException('Sale does not match device and local ID');
  try {
   return await this.db.paymentException.create({data:{
    locationId:d.locationId,deviceId:d.deviceId,localSaleId:d.localSaleId,
    saleId:sale?.id??null,reason:d.reason.trim(),reportedById:u.id,
    expectedAmount:d.expectedAmount===undefined?null:new Prisma.Decimal(d.expectedAmount.toFixed(2)),
    observedAmount:d.observedAmount===undefined?null:new Prisma.Decimal(d.observedAmount.toFixed(2))
   }});
  }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('A case already exists for this device and local sale ID');throw e;}
 }
 @Get() @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async list(@Query('locationId') locationId:string,@Query('status') status:string|undefined,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  if(status&&!Object.values(PaymentExceptionStatus).includes(status as PaymentExceptionStatus))throw new BadRequestException('Invalid status');
  return this.db.paymentException.findMany({where:{locationId,...(status?{status:status as PaymentExceptionStatus}:{})},
   orderBy:{createdAt:'desc'},take:100,include:{_count:{select:{evidences:true}}}});
 }
 @Get(':id') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async detail(@Param('id') id:string,@CurrentUser() u:Principal){
  await this.access(id,u);
  return this.db.paymentException.findUniqueOrThrow({where:{id},include:{evidences:{orderBy:{createdAt:'asc'}}}});
 }
 @Post(':id/evidence') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async evidence(@Param('id') id:string,@Body() d:EvidenceDto,@CurrentUser() u:Principal){
  const item=await this.access(id,u);
  if(item.status==='RESOLVED'||item.status==='VOIDED')throw new ConflictException('Closed case is immutable');
  if(!d.reference.trim()||!d.note.trim())throw new BadRequestException('Reference and note required');
  return this.db.paymentExceptionEvidence.create({data:{
   exceptionId:id,kind:d.kind,reference:d.reference.trim(),note:d.note.trim(),createdById:u.id
  }});
 }
 @Patch(':id/review') @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 async review(@Param('id') id:string,@Body() d:ReviewDto,@CurrentUser() u:Principal){
  this.manager(u);
  const item=await this.access(id,u);
  if(!d.note.trim())throw new BadRequestException('Review note required');
  if(!['UNDER_REVIEW','RESOLVED','VOIDED'].includes(d.status))throw new BadRequestException('Invalid review transition');
  if(!['OPEN','UNDER_REVIEW'].includes(item.status))throw new ConflictException('Closed case cannot be changed');
  const result=await this.db.paymentException.updateMany({
   where:{id,status:item.status},
   data:{status:d.status,reviewNote:d.note.trim(),reviewedById:u.id,
    resolvedAt:d.status==='UNDER_REVIEW'?null:new Date()}
  });
  if(result.count!==1)throw new ConflictException('Case changed concurrently; reload');
  return this.db.paymentException.findUniqueOrThrow({where:{id}});
 }
}
