import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { OnlinePaymentMethod, Prisma } from '@prisma/client';
import { Db } from './db';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, Principal } from './auth';
class LineDto { @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; }
class CheckoutDto {
 @IsString() @MinLength(8) idempotencyKey!:string;
 @IsString() @MinLength(2) @MaxLength(100) customerName!:string;
 @IsString() @MinLength(8) @MaxLength(25) phone!:string;
 @IsOptional() @IsEmail() email?:string;
 @IsString() @MinLength(8) @MaxLength(500) address!:string;
 @IsString() @MinLength(2) @MaxLength(100) city!:string;
 @IsEnum(OnlinePaymentMethod) paymentMethod!:OnlinePaymentMethod;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>LineDto) items!:LineDto[];
}
class OnlineReturnLineDto { @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsOptional() @IsBoolean() quarantined?:boolean; }
class OnlineReturnDto { @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!:string; @IsString() @MinLength(3) @MaxLength(500) reason!:string; @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>OnlineReturnLineDto) lines!:OnlineReturnLineDto[]; }
class OnlineRefundDto {
 @IsUUID() returnId!:string;
 @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!:string;
 @IsString() @MinLength(3) @MaxLength(30) method!:string;
 @IsString() @MinLength(3) @MaxLength(100) reference!:string;
 @IsInt() @Min(1) amountPaisa!:number;
}
class DispatchDto { @IsString() @MinLength(8) idempotencyKey!:string; @IsString() @MinLength(2) courierName!:string; @IsString() @MinLength(2) trackingNumber!:string; }
class ActionDto { @IsString() @MinLength(8) idempotencyKey!:string; }
@Injectable()
export class OnlineService {
 constructor(private db:Db){}
 private digest(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
 private shippingFee(){const raw=process.env.ONLINE_COD_SHIPPING_PKR;if(raw===undefined)throw new ConflictException('COD shipping fee is not configured');if(!/^(0|[1-9][0-9]*)([.][0-9]{1,2})?$/.test(raw))throw new ConflictException('Invalid ONLINE_COD_SHIPPING_PKR configuration');return new Prisma.Decimal(raw);}
 async checkout(d:CheckoutDto){
  if(new Set(d.items.map(x=>x.variantId)).size!==d.items.length)throw new BadRequestException('Duplicate variants');
  // Card/wallet payment is not yet integrated. Do not collect or claim to charge these methods.
  if(d.paymentMethod!=='COD')throw new BadRequestException('Only COD is currently enabled. Online payment gateways require verified provider integration.');
  const shippingFee=this.shippingFee();
  const hash=this.digest(d);
  return this.db.$transaction(async tx=>{
   const previous=await tx.onlineOrder.findUnique({where:{idempotencyKey:d.idempotencyKey}});
   if(previous){if(previous.requestHash!==hash)throw new ConflictException('Idempotency key reused with different checkout');return previous;}
   const warehouse=await tx.location.findFirst({where:{type:'ONLINE',active:true},orderBy:{code:'asc'}});
   if(!warehouse)throw new ConflictException('No active online-store inventory location');
   const sorted=[...d.items].sort((a,b)=>a.variantId.localeCompare(b.variantId));
   let subtotal=new Prisma.Decimal(0);const lines:{variantId:string;quantity:number;unitPrice:Prisma.Decimal}[]=[];
   for(const item of sorted){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${warehouse.id+':'+item.variantId}))`;
    const variant=await tx.productVariant.findFirst({where:{id:item.variantId,active:true,product:{active:true}}});
    if(!variant)throw new BadRequestException('Unavailable product variant');
    const balance=await tx.stockBalance.findUnique({where:{locationId_variantId:{locationId:warehouse.id,variantId:item.variantId}}});
    if(!balance||balance.onHand-balance.reservedOnline-balance.reservedReplenish-balance.quarantined-balance.safetyBuffer<item.quantity)throw new ConflictException(`Insufficient online-store allocated stock for ${variant.sku}`);
    subtotal=subtotal.plus(variant.price.mul(item.quantity));lines.push({variantId:item.variantId,quantity:item.quantity,unitPrice:variant.price});
   }
   const order=await tx.onlineOrder.create({data:{orderNumber:`ON-${randomUUID().slice(0,8).toUpperCase()}`,idempotencyKey:d.idempotencyKey,requestHash:hash,warehouseId:warehouse.id,customerName:d.customerName,phone:d.phone,email:d.email,address:d.address,city:d.city,paymentMethod:d.paymentMethod,subtotal,shippingFee,total:subtotal.plus(shippingFee),lines:{create:lines}}});
   for(const line of lines){
    await tx.stockReservation.create({data:{locationId:warehouse.id,variantId:line.variantId,purpose:'ONLINE_ORDER',quantity:line.quantity,referenceId:order.id}});
    await tx.stockBalance.update({where:{locationId_variantId:{locationId:warehouse.id,variantId:line.variantId}},data:{reservedOnline:{increment:line.quantity},version:{increment:1}}});
   }
   await tx.auditLog.create({data:{action:'ONLINE_ORDER_PLACED',entityType:'OnlineOrder',entityId:order.id,after:{total:subtotal.plus(shippingFee).toString(),shippingFee:shippingFee.toString(),itemCount:lines.length}}});
   return order;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
 async settleOnlineRefund(dto:OnlineRefundDto,u:Principal){
  const methods=['CASH','BANK_TRANSFER','CARD','EASYPAISA','JAZZCASH','OTHER'];
  if(!methods.includes(dto.method)||dto.reference.trim()!==dto.reference)throw new BadRequestException('Valid refund method and external payment reference required');
  if(!Number.isSafeInteger(dto.amountPaisa))throw new BadRequestException('Refund amount must be a safe integer in paisa');
  const amount=new Prisma.Decimal(dto.amountPaisa).div(100);
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT id FROM "OnlineReturn" WHERE id = ${dto.returnId}::uuid FOR UPDATE`;
   const prior=await tx.onlineRefundSettlement.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(prior){if(prior.returnId!==dto.returnId||prior.method!==dto.method||prior.reference!==dto.reference||!prior.amount.equals(amount))throw new ConflictException('Refund key reused with different details');return prior;}
   const ret=await tx.onlineReturn.findUnique({where:{id:dto.returnId}});
   if(!ret)throw new BadRequestException('Approved online return required');
   const sum=await tx.onlineRefundSettlement.aggregate({where:{returnId:ret.id},_sum:{amount:true}});
   if(amount.greaterThan(ret.merchandiseAmount.minus(sum._sum.amount??new Prisma.Decimal(0))))throw new ConflictException('Refund exceeds remaining merchandise amount');
   const result=await tx.onlineRefundSettlement.create({data:{returnId:ret.id,idempotencyKey:dto.idempotencyKey,method:dto.method,reference:dto.reference,amount,settledById:u.id}});
   await tx.auditLog.create({data:{actorId:u.id,action:'ONLINE_REFUND_SETTLEMENT_RECORDED',entityType:'OnlineRefundSettlement',entityId:result.id,after:{returnId:ret.id,method:dto.method,amount:amount.toString(),reference:dto.reference}}});
   return {...result,note:'Recorded an externally completed refund; this API does not transfer money.'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
 async onlineRefundStatus(returnId:string){
  const ret=await this.db.onlineReturn.findUnique({where:{id:returnId},include:{settlements:{orderBy:{settledAt:'desc'}}}});
  if(!ret)throw new BadRequestException('Approved online return not found');
  const paid=ret.settlements.reduce((n,s)=>n.plus(s.amount),new Prisma.Decimal(0));
  return {returnId:ret.id,approvedAmount:ret.merchandiseAmount.toString(),recordedAmount:paid.toString(),remainingAmount:ret.merchandiseAmount.minus(paid).toString(),settlements:ret.settlements,note:'Recorded payments only. No payment provider integration or disbursement is performed.'};
 }
 async returnDeliveredOrder(id:string,dto:OnlineReturnDto,u:Principal){
  if(new Set(dto.lines.map(x=>x.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate return variants');
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "OnlineOrder" WHERE id = ${id}::uuid FOR UPDATE`;
   const previous=await tx.onlineReturn.findUnique({where:{idempotencyKey:dto.idempotencyKey},include:{lines:true}});
   if(previous){const expected=[...dto.lines].map(x=>({variantId:x.variantId,quantity:x.quantity,quarantined:x.quarantined===true})).sort((a,b)=>a.variantId.localeCompare(b.variantId));const actual=previous.lines.map(x=>({variantId:x.variantId,quantity:x.quantity,quarantined:x.quarantined})).sort((a,b)=>a.variantId.localeCompare(b.variantId));if(previous.orderId!==id||previous.reason!==dto.reason||JSON.stringify(expected)!==JSON.stringify(actual))throw new ConflictException('Return key reused with different request');return previous;}
   const order=await tx.onlineOrder.findUnique({where:{id},include:{lines:true,returns:{include:{lines:true}}}});
   if(!order||order.status!=='DELIVERED')throw new BadRequestException('Delivered order required');
   const lines=[];
   for(const line of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const sold=order.lines.find(x=>x.variantId===line.variantId);
    if(!sold)throw new BadRequestException('Variant not present in original order');
    const returned=order.returns.flatMap(r=>r.lines).filter(x=>x.variantId===line.variantId).reduce((n,x)=>n+x.quantity,0);
    if(line.quantity>sold.quantity-returned)throw new ConflictException('Return exceeds remaining purchased quantity');
    lines.push({variantId:line.variantId,quantity:line.quantity,quarantined:line.quarantined===true,unitPrice:sold.unitPrice});
   }
   const merchandiseAmount=lines.reduce((sum,x)=>sum.plus(x.unitPrice.mul(x.quantity)),new Prisma.Decimal(0));
   const ret=await tx.onlineReturn.create({data:{orderId:id,idempotencyKey:dto.idempotencyKey,reason:dto.reason,approvedById:u.id,merchandiseAmount,lines:{create:lines}},include:{lines:true}});
   for(const line of lines){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.warehouseId+':'+line.variantId}))`;
    await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:order.warehouseId,variantId:line.variantId}},create:{locationId:order.warehouseId,variantId:line.variantId,onHand:line.quantity,quarantined:line.quarantined?line.quantity:0},update:{onHand:{increment:line.quantity},...(line.quarantined?{quarantined:{increment:line.quantity}}:{}),version:{increment:1}}});
    await tx.stockMovement.create({data:{locationId:order.warehouseId,variantId:line.variantId,type:'SALE_RETURN',quantityDelta:line.quantity,referenceType:'ONLINE_RETURN',referenceId:ret.id,idempotencyKey:`online-return:${ret.id}:${line.variantId}`,actorId:u.id}});
   }
   const earning=await tx.loyaltyEntry.findUnique({where:{orderId:id}});
   if(earning&&earning.points>0&&order.subtotal.greaterThan(0)){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'loyalty-customer:'+earning.customerId}))`;
    // Serialize with manual loyalty reversals for the same earning entry.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'loyalty-entry:'+earning.id}))`;
    const previousReturned=order.returns.reduce((sum,r)=>sum.plus(r.lines.reduce((n,l)=>n.plus(l.unitPrice.mul(l.quantity)),new Prisma.Decimal(0))),new Prisma.Decimal(0));
    const totalReturned=previousReturned.plus(merchandiseAmount);
    const targetReversed=Number(totalReturned.div(order.subtotal).mul(earning.points).floor().toString());
    const prior=await tx.loyaltyAdjustment.aggregate({where:{sourceEntryId:earning.id},_sum:{points:true}});
    const remaining=Math.max(0,earning.points+(prior._sum.points??0));
    const redeemed=await tx.loyaltyRedemption.aggregate({where:{customerId:earning.customerId},_sum:{points:true}});
    const [allEarned,allReversed]=await Promise.all([
     tx.loyaltyEntry.aggregate({where:{customerId:earning.customerId},_sum:{points:true}}),
     tx.loyaltyAdjustment.aggregate({where:{customerId:earning.customerId},_sum:{points:true}})
    ]);
    const spendable=(allEarned._sum.points??0)+(allReversed._sum.points??0)-(redeemed._sum.points??0);
    const requested=Math.min(remaining,Math.max(0,targetReversed+(prior._sum.points??0)));
    if(requested>spendable)throw new ConflictException('Return loyalty reversal would exceed unspent points; reconcile existing redemptions before approving this return');
    const toReverse=requested;
    if(toReverse>0){await tx.loyaltyAdjustment.create({data:{customerId:earning.customerId,sourceEntryId:earning.id,idempotencyKey:`online-return-loyalty:${ret.id}`,points:-toReverse,reason:`Automatic merchandise return ${ret.id}`,actorId:u.id}});}
   }
   await tx.auditLog.create({data:{actorId:u.id,action:'ONLINE_RETURN_APPROVED',entityType:'OnlineReturn',entityId:ret.id,after:{orderId:id,merchandiseAmount:merchandiseAmount.toString(),lines:lines.map(x=>({variantId:x.variantId,quantity:x.quantity,quarantined:x.quarantined}))}}});
   return {...ret,note:'Inventory restored; any eligible earned loyalty points adjusted. Financial refund is NOT paid or recorded by this action. Shipping is excluded.'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000});
 }
 async action(id:string,kind:'CONFIRMED'|'DISPATCHED'|'DELIVERED'|'CANCELLED',dto:ActionDto&Partial<DispatchDto>,u:Principal){
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "OnlineOrder" WHERE id = ${id}::uuid FOR UPDATE`;
   const order=await tx.onlineOrder.findUnique({where:{id},include:{lines:true}});
   if(!order)throw new BadRequestException('Order not found');
   const key=await tx.integrationEvent.findUnique({where:{idempotencyKey:dto.idempotencyKey}});
   if(key){if(key.source!==`ONLINE_${kind}`||key.eventType!==id)throw new ConflictException('Idempotency key reused');return order;}
   const transitions:Record<string,string[]>={CONFIRMED:['PLACED'],DISPATCHED:['CONFIRMED'],DELIVERED:['DISPATCHED'],CANCELLED:['PLACED','CONFIRMED']};
   if(!transitions[kind].includes(order.status))throw new ConflictException(`Cannot ${kind} from ${order.status}`);
   if(kind==='DISPATCHED'&&(!dto.courierName||!dto.trackingNumber))throw new BadRequestException('Courier and tracking number required');
   if(kind==='DISPATCHED'||kind==='CANCELLED'){
    for(const line of [...order.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.warehouseId+':'+line.variantId}))`;
     const reservation=await tx.stockReservation.findFirstOrThrow({where:{referenceId:id,variantId:line.variantId,purpose:'ONLINE_ORDER',status:'ACTIVE'}});
     await tx.stockReservation.update({where:{id:reservation.id},data:{status:kind==='DISPATCHED'?'CONSUMED':'RELEASED'}});
     await tx.stockBalance.update({where:{locationId_variantId:{locationId:order.warehouseId,variantId:line.variantId}},data:{reservedOnline:{decrement:line.quantity},...(kind==='DISPATCHED'?{onHand:{decrement:line.quantity}}:{}),version:{increment:1}}});
     if(kind==='DISPATCHED')await tx.stockMovement.create({data:{locationId:order.warehouseId,variantId:line.variantId,type:'SALE',quantityDelta:-line.quantity,referenceType:'ONLINE_ORDER',referenceId:id,idempotencyKey:`online-dispatch:${id}:${line.variantId}`,actorId:u.id}});
    }
   }
   // Loyalty accrues only when explicitly enabled and only for existing customer records.
   // No automatic redemption, cash value, or refund adjustments are implied.
   if(kind==='DELIVERED'&&process.env.LOYALTY_PKR_PER_POINT){
    const raw=process.env.LOYALTY_PKR_PER_POINT;
    if(!/^[1-9][0-9]*$/.test(raw))throw new ConflictException('Invalid loyalty earning configuration');
    const customer=await tx.retailCustomer.findUnique({where:{phone:order.phone}});
    if(customer){
     const points=Number(order.subtotal.div(new Prisma.Decimal(raw)).floor().toString());
     if(!Number.isSafeInteger(points)||points<0)throw new ConflictException('Loyalty points exceed supported range');
     await tx.loyaltyEntry.create({data:{customerId:customer.id,orderId:order.id,points,amount:order.subtotal}});
     await tx.auditLog.create({data:{actorId:u.id,action:'LOYALTY_POINTS_EARNED',entityType:'LoyaltyEntry',entityId:order.id,after:{customerId:customer.id,points,source:'DELIVERED_ONLINE_ORDER'}}});
    }
   }
   const updated=await tx.onlineOrder.update({where:{id},data:{status:kind,...(kind==='DISPATCHED'?{dispatchedAt:new Date(),courierName:dto.courierName,trackingNumber:dto.trackingNumber}:{})}});
   await tx.integrationEvent.create({data:{source:`ONLINE_${kind}`,eventType:id,idempotencyKey:dto.idempotencyKey,payload:{orderId:id,kind},processedAt:new Date()}});
   await tx.auditLog.create({data:{actorId:u.id,action:`ONLINE_${kind}`,entityType:'OnlineOrder',entityId:id,before:{status:order.status},after:{status:kind}}});
   return updated;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
}
@Controller('store') export class StoreController {
 constructor(private db:Db,private svc:OnlineService){}
 @Get('shipping') shipping(){const raw=process.env.ONLINE_COD_SHIPPING_PKR;const valid=raw!==undefined&&/^(0|[1-9][0-9]*)([.][0-9]{1,2})?$/.test(raw);return {available:valid,shippingFee:valid?raw:null,currency:'PKR',paymentMethod:'COD'};}
 @Get('products') async products(){
  const warehouse=await this.db.location.findFirst({where:{type:'ONLINE',active:true},orderBy:{code:'asc'}});
  const products=await this.db.product.findMany({where:{active:true},include:{category:true,brand:true,variants:{where:{active:true},include:{balances:{where:{locationId:warehouse?.id??'00000000-0000-0000-0000-000000000000'}}}}},orderBy:{createdAt:'desc'},take:200});
  return products.map(p=>({id:p.id,title:p.title,slug:p.slug,description:p.description,category:p.category.name,brand:p.brand?.name??null,variants:p.variants.map(v=>({id:v.id,sku:v.sku,size:v.size,color:v.color,price:v.price.toString(),available:Math.max(0,(v.balances[0]?.onHand??0)-(v.balances[0]?.reservedOnline??0)-(v.balances[0]?.reservedReplenish??0)-(v.balances[0]?.quarantined??0)-(v.balances[0]?.safetyBuffer??0))}))}));
 }
 @Post('checkout') checkout(@Body() dto:CheckoutDto){return this.svc.checkout(dto);}
}
@Controller('orders') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','ECOMMERCE_MANAGER')
export class OrdersController {
 constructor(private db:Db,private svc:OnlineService){}
 @Get() list(@Query('status') status?:string){return this.db.onlineOrder.findMany({where:status&&['PLACED','CONFIRMED','DISPATCHED','DELIVERED','CANCELLED'].includes(status)?{status:status as any}:{},include:{lines:{include:{variant:{select:{sku:true}}}}},orderBy:{createdAt:'desc'},take:200});}
 @Post('refunds/settle') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') settleRefund(@Body() dto:OnlineRefundDto,@CurrentUser() u:Principal){return this.svc.settleOnlineRefund(dto,u);}
 @Get('refunds/:returnId') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') refundStatus(@Param('returnId') id:string){return this.svc.onlineRefundStatus(id);}
 @Get(':id/returns') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') async listReturns(@Param('id') id:string){const order=await this.db.onlineOrder.findUnique({where:{id},select:{id:true}});if(!order)throw new BadRequestException('Order not found');return this.db.onlineReturn.findMany({where:{orderId:id},include:{lines:true},orderBy:{createdAt:'desc'}});}
 @Post(':id/returns') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') returnOrder(@Param('id') id:string,@Body() dto:OnlineReturnDto,@CurrentUser() u:Principal){return this.svc.returnDeliveredOrder(id,dto,u);}
 @Post(':id/confirm') confirm(@Param('id') id:string,@Body() d:ActionDto,@CurrentUser() u:Principal){return this.svc.action(id,'CONFIRMED',d,u);}
 @Post(':id/dispatch') dispatch(@Param('id') id:string,@Body() d:DispatchDto,@CurrentUser() u:Principal){return this.svc.action(id,'DISPATCHED',d,u);}
 @Post(':id/deliver') deliver(@Param('id') id:string,@Body() d:ActionDto,@CurrentUser() u:Principal){return this.svc.action(id,'DELIVERED',d,u);}
 @Post(':id/cancel') cancel(@Param('id') id:string,@Body() d:ActionDto,@CurrentUser() u:Principal){return this.svc.action(id,'CANCELLED',d,u);}
}
