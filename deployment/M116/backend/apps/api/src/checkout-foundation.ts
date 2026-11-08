import { BadRequestException, Body, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Db } from './db';
import { Prisma } from '@prisma/client';
import { CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';
class QuoteDto {
 @IsString() code!: string;
 @IsNumber() @Min(0) subtotal!: number;
}
@Controller('checkout-foundation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
export class CheckoutFoundationController {
 constructor(private readonly db: Db) {}
 @Get('customers') async customers(@Query('phone') phone?:string){
  if(!phone || phone.trim().length<5) throw new BadRequestException('Provide at least 5 phone characters');
  return this.db.retailCustomer.findMany({where:{phone:{contains:phone.trim()}},select:{id:true,name:true,phone:true},take:20});
 }
 @Get('loyalty') async loyalty(@Query('customerId') customerId?:string){
  if(!customerId) throw new BadRequestException('customerId required');
  await this.db.retailCustomer.findUniqueOrThrow({where:{id:customerId}});
  const rows=await this.db.loyaltyLedgerEntry.findMany({where:{customerId},orderBy:{createdAt:'desc'},take:100});
  const aggregate=await this.db.loyaltyLedgerEntry.aggregate({where:{customerId},_sum:{points:true}});
  return {customerId,balance:aggregate._sum.points??0,entries:rows};
 }
 @Get('promotions') async promotions(){
  return this.db.retailPromotion.findMany({where:{status:'ACTIVE',startsAt:{lte:new Date()},endsAt:{gt:new Date()}},select:{id:true,code:true,title:true,type:true,value:true,startsAt:true,endsAt:true}});
 }
 // Informational quote only. It does not authorize a discounted sale.
 @Get('promotion-preview') async promotionPreview(@Query('code') code?:string,@Query('subtotal') subtotal?:string){
  if(!code?.trim() || !subtotal || !/^\d+(\.\d{1,2})?$/.test(subtotal))
   throw new BadRequestException('Provide promotion code and positive subtotal with at most 2 decimals');
  const amount=new Prisma.Decimal(subtotal);
  if(amount.lte(0)||amount.gt(100000000))throw new BadRequestException('Invalid subtotal');
  const promo=await this.db.retailPromotion.findUnique({where:{code:code.trim().toUpperCase()}});
  const now=new Date();
  if(!promo||promo.status!=='ACTIVE'||promo.startsAt>now||promo.endsAt<=now)
   return {eligible:false,reason:'Code is not active',checkoutEnabled:false};
  if(!['PERCENT','FIXED'].includes(promo.type))
   return {eligible:false,reason:'Unsupported promotion type',checkoutEnabled:false};
  const discount=promo.type==='PERCENT'?amount.mul(promo.value).div(100):promo.value;
  const capped=Prisma.Decimal.min(amount,discount).toDecimalPlaces(2,Prisma.Decimal.ROUND_HALF_UP);
  return {eligible:true,code:promo.code,title:promo.title,subtotal:amount.toFixed(2),
   estimatedDiscount:capped.toFixed(2),estimatedTotal:amount.minus(capped).toFixed(2),
   checkoutEnabled:false,warning:'Preview only. POS does not apply or redeem this discount.'};
 }
 @Get('redemptions') async redemptions(@Query('saleId') saleId?:string){
  if(!saleId)throw new BadRequestException('saleId required');
  const rows=await this.db.promotionRedemption.findMany({where:{saleId}});
  return rows.map(r=>({...r,discountAmount:r.discountAmount.toString()}));
 }
 // Preview only: no price changes, no reservations, no redemption records.
 // Do not trust a client-side quote as a final checkout discount.
 @Get('health') health(){return {ready:true,mode:'read-only foundation',checkoutIntegration:false};}
}
