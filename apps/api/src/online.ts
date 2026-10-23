import { randomUUID, createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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
class DispatchDto { @IsString() @MinLength(8) idempotencyKey!:string; @IsString() @MinLength(2) courierName!:string; @IsString() @MinLength(2) trackingNumber!:string; }
class ActionDto { @IsString() @MinLength(8) idempotencyKey!:string; }
@Injectable()
export class OnlineService {
 constructor(private db:Db){}
 private digest(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
 private shippingFee(){const raw=process.env.ONLINE_COD_SHIPPING_PKR;if(raw===undefined)throw new ConflictException('COD shipping fee is not configured');if(!/^(0|[1-9]\\d*)(\\.\\d{1,2})?$/.test(raw))throw new ConflictException('Invalid ONLINE_COD_SHIPPING_PKR configuration');return new Prisma.Decimal(raw);}
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
   const updated=await tx.onlineOrder.update({where:{id},data:{status:kind,...(kind==='DISPATCHED'?{dispatchedAt:new Date(),courierName:dto.courierName,trackingNumber:dto.trackingNumber}:{})}});
   await tx.integrationEvent.create({data:{source:`ONLINE_${kind}`,eventType:id,idempotencyKey:dto.idempotencyKey,payload:{orderId:id,kind},processedAt:new Date()}});
   await tx.auditLog.create({data:{actorId:u.id,action:`ONLINE_${kind}`,entityType:'OnlineOrder',entityId:id,before:{status:order.status},after:{status:kind}}});
   return updated;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
}
@Controller('store') export class StoreController {
 constructor(private db:Db,private svc:OnlineService){}
 @Get('shipping') shipping(){const raw=process.env.ONLINE_COD_SHIPPING_PKR;const valid=raw!==undefined&&/^(0|[1-9]\\d*)(\\.\\d{1,2})?$/.test(raw);return {available:valid,shippingFee:valid?raw:null,currency:'PKR',paymentMethod:'COD'};}
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
 @Post(':id/confirm') confirm(@Param('id') id:string,@Body() d:ActionDto,@CurrentUser() u:Principal){return this.svc.action(id,'CONFIRMED',d,u);}
 @Post(':id/dispatch') dispatch(@Param('id') id:string,@Body() d:DispatchDto,@CurrentUser() u:Principal){return this.svc.action(id,'DISPATCHED',d,u);}
 @Post(':id/deliver') deliver(@Param('id') id:string,@Body() d:ActionDto,@CurrentUser() u:Principal){return this.svc.action(id,'DELIVERED',d,u);}
 @Post(':id/cancel') cancel(@Param('id') id:string,@Body() d:ActionDto,@CurrentUser() u:Principal){return this.svc.action(id,'CANCELLED',d,u);}
}
