import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Db } from './db';
import { CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard, assertLocation } from './auth';
class LinkCustomerDto { @IsUUID() saleId!:string; @IsUUID() customerId!:string; }
class RefundDto { @IsUUID() returnId!:string; @IsIn(['CASH','CARD','BANK','OTHER']) method!:string; }
class SettleDto { @IsString() @MinLength(3) reference!:string; }
class PromoDto {
 @IsString() @MinLength(3) code!:string;
 @IsString() @MinLength(3) title!:string;
 @IsIn(['PERCENT','FIXED']) type!:'PERCENT'|'FIXED';
 @IsNumber() @Min(0.01) value!:number;
 @IsString() startsAt!:string;
 @IsString() endsAt!:string;
}
@Controller('customer-finance')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class CustomerFinanceController {
 constructor(private db:Db){}
 @Post('sale-customer')
 async link(@CurrentUser() u:Principal,@Body() d:LinkCustomerDto){
  const sale=await this.db.posSale.findUniqueOrThrow({where:{id:d.saleId}});
  assertLocation(u,sale.locationId);
  if(sale.status!=='ACCEPTED')throw new BadRequestException('Only accepted sales can be linked');
  await this.db.retailCustomer.findUniqueOrThrow({where:{id:d.customerId}});
  return this.db.$transaction(async tx=>{
   const prior=await tx.saleCustomerLink.findUnique({where:{saleId:d.saleId}});
   if(prior){if(prior.customerId===d.customerId)return prior;throw new ConflictException('Sale already linked to a different customer');}
   const link=await tx.saleCustomerLink.create({data:{...d,linkedById:u.id}});
   await tx.auditLog.create({data:{actorId:u.id,action:'SALE_CUSTOMER_LINKED',entityType:'PosSale',entityId:d.saleId,after:{customerId:d.customerId}}});
   return link;
  });
 }
 @Get('customer-sales')
 async customerSales(@CurrentUser() u:Principal,@Query('customerId') customerId?:string){
  if(!customerId)throw new BadRequestException('customerId required');
  const links=await this.db.saleCustomerLink.findMany({where:{customerId},orderBy:{linkedAt:'desc'},take:100});
  const sales=await this.db.posSale.findMany({where:{id:{in:links.map(l=>l.saleId)},...(u.roles.includes('SUPER_ADMIN')?{}:{locationId:{in:u.locations}})},select:{id:true,locationId:true,total:true,soldAt:true,status:true,localSaleId:true},orderBy:{soldAt:'desc'}});
  return sales.map(s=>({...s,total:s.total.toString()}));
 }
 @Get('refunds')
 async refunds(@CurrentUser() u:Principal){
  const rows=await this.db.refundRecord.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{locationId:{in:u.locations}},orderBy:{createdAt:'desc'},take:100});
  return rows.map(r=>({...r,amount:r.amount.toString()}));
 }
 @Post('refunds')
 async request(@CurrentUser() u:Principal,@Body() d:RefundDto){
  const ret=await this.db.posReturn.findUniqueOrThrow({where:{id:d.returnId},include:{lines:true}});
  assertLocation(u,ret.locationId);
  const amount=ret.lines.reduce((sum,l)=>sum+l.refundAmount.toNumber(),0);
  if(amount<=0)throw new BadRequestException('Return has no refundable amount');
  return this.db.refundRecord.create({data:{returnId:ret.id,locationId:ret.locationId,amount,method:d.method,requestedById:u.id}})
    .catch(e=>{if(e?.code==='P2002')throw new ConflictException('Refund already registered');throw e;});
 }
 @Post('refunds/:id/approve')
 @Roles('SUPER_ADMIN')
 async approve(@CurrentUser() u:Principal,@Param('id') id:string){
  const r=await this.db.refundRecord.updateMany({where:{id,status:'REQUESTED'},data:{status:'APPROVED',reviewedById:u.id,reviewedAt:new Date()}});
  if(r.count!==1)throw new ConflictException('Refund not awaiting approval');
  await this.db.auditLog.create({data:{actorId:u.id,action:'REFUND_APPROVED',entityType:'RefundRecord',entityId:id}});
  return {id,status:'APPROVED'};
 }
 @Post('refunds/:id/mark-paid')
 @Roles('SUPER_ADMIN')
 async paid(@CurrentUser() u:Principal,@Param('id') id:string,@Body() d:SettleDto){
  // Administrative confirmation only: this endpoint NEVER transfers money.
  const r=await this.db.refundRecord.updateMany({where:{id,status:'APPROVED'},data:{status:'PAID',reference:d.reference,settledById:u.id,settledAt:new Date()}});
  if(r.count!==1)throw new ConflictException('Refund not approved or already settled');
  await this.db.auditLog.create({data:{actorId:u.id,action:'REFUND_MARKED_PAID',entityType:'RefundRecord',entityId:id,after:{reference:d.reference}}});
  return {id,status:'PAID',warning:'Manual settlement recorded; no funds were transferred by this API'};
 }
 @Get('promotions')
 promotions(){return this.db.retailPromotion.findMany({orderBy:{createdAt:'desc'},take:100});}
 @Post('promotions')
 @Roles('SUPER_ADMIN')
 async promotion(@CurrentUser() u:Principal,@Body() d:PromoDto){
  const startsAt=new Date(d.startsAt),endsAt=new Date(d.endsAt);
  if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt)
   throw new BadRequestException('Invalid promotion date range');
  if(d.type==='PERCENT'&&d.value>100)throw new BadRequestException('Percentage cannot exceed 100');
  return this.db.retailPromotion.create({data:{code:d.code.toUpperCase(),title:d.title,type:d.type,value:d.value,startsAt,endsAt,createdById:u.id}});
 }
}
