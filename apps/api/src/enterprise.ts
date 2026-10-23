import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';
const guards=[JwtAuthGuard,RolesGuard];
class SupplierDto { @IsString() @MinLength(2) code!:string; @IsString() @MinLength(2) name!:string; @IsOptional() @IsString() phone?:string; @IsOptional() @IsEmail() email?:string; }
class PoLine { @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsNumber({maxDecimalPlaces:2}) @Min(0) unitCost!:number; }
class PoDto { @IsUUID() supplierId!:string; @IsUUID() warehouseId!:string; @IsString() @MinLength(5) reference!:string; @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>PoLine) lines!:PoLine[]; }
class ReceiveLine { @IsUUID() variantId!:string; @IsInt() @Min(0) quantity!:number; @IsInt() @Min(0) damaged!:number; }
class ReceiveDto { @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>ReceiveLine) lines!:ReceiveLine[]; }
@Controller('purchasing') @UseGuards(...guards) @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER')
export class PurchasingController {
 constructor(private db:Db){}
 @Get('suppliers') suppliers(){return this.db.supplier.findMany({orderBy:{name:'asc'}});}
 @Post('suppliers') supplier(@Body() dto:SupplierDto){return this.db.supplier.create({data:dto});}
 @Get('orders') orders(){return this.db.purchaseOrder.findMany({include:{supplier:true,lines:true},orderBy:{createdAt:'desc'},take:200});}
 @Post('orders') async order(@Body() dto:PoDto,@CurrentUser() u:Principal){
  assertLocation(u,dto.warehouseId);
  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variants');
  const loc=await this.db.location.findUniqueOrThrow({where:{id:dto.warehouseId}});
  if(loc.type!=='WAREHOUSE')throw new BadRequestException('Purchase receiving location must be warehouse');
  return this.db.purchaseOrder.create({data:{supplierId:dto.supplierId,warehouseId:dto.warehouseId,reference:dto.reference,status:'SUBMITTED',lines:{create:dto.lines.map(l=>({variantId:l.variantId,orderedQty:l.quantity,unitCost:new Prisma.Decimal(l.unitCost.toFixed(2))}))}},include:{lines:true}});
 }
 @Post('orders/:id/receive') async receive(@Param('id') id:string,@Body() dto:ReceiveDto,@CurrentUser() u:Principal){
  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variants');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${id}`}))`;
   const order=await tx.purchaseOrder.findUniqueOrThrow({where:{id},include:{lines:true}});
   assertLocation(u,order.warehouseId);
   if(order.status==='RECEIVED')throw new ConflictException('Already received');
   if(order.status!=='SUBMITTED')throw new ConflictException('Purchase order not submitted');
   if(dto.lines.length!==order.lines.length)throw new BadRequestException('Supply a quantity for every order line');
   for(const line of order.lines){
    const r=dto.lines.find(x=>x.variantId===line.variantId);
    if(!r||r.quantity+r.damaged>line.orderedQty)throw new BadRequestException('Receipt exceeds ordered quantity');
   }
   for(const line of [...order.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const r=dto.lines.find(x=>x.variantId===line.variantId)!;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.warehouseId+':'+line.variantId}))`;
    const qty=r.quantity+r.damaged;
    await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:order.warehouseId,variantId:line.variantId}},create:{locationId:order.warehouseId,variantId:line.variantId,onHand:qty,quarantined:r.damaged},update:{onHand:{increment:qty},quarantined:{increment:r.damaged},version:{increment:1}}});
    await tx.purchaseOrderLine.update({where:{id:line.id},data:{receivedQty:qty}});
    if(qty)await tx.stockMovement.create({data:{locationId:order.warehouseId,variantId:line.variantId,type:'SUPPLIER_RECEIPT',quantityDelta:qty,referenceType:'PURCHASE_ORDER',referenceId:id,idempotencyKey:`purchase:${id}:${line.variantId}`,actorId:u.id,metadata:{damaged:r.damaged}}});
   }
   await tx.purchaseOrder.update({where:{id},data:{status:'RECEIVED',receivedAt:new Date()}});
   await tx.auditLog.create({
    data: {
        actorId: u.id,
        action: 'PURCHASE_RECEIVED',
        entityType: 'PurchaseOrder',
        entityId: id,
        after: JSON.parse(JSON.stringify({ lines: dto.lines })),
    },
   });
   return {id,status:'RECEIVED'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
}
class CountLine { @IsUUID() variantId!:string; @IsInt() @Min(0) countedQty!:number; }
class CountDto { @IsUUID() locationId!:string; @IsString() @MinLength(5) reference!:string; @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>CountLine) lines!:CountLine[]; }
@Controller('stock-counts') @UseGuards(...guards) @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER','BRANCH_MANAGER')
export class StockCountsController {
 constructor(private db:Db){}
 @Get() list(@CurrentUser() u:Principal){return this.db.stockCount.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{locationId:{in:u.locations}},include:{lines:true},orderBy:{createdAt:'desc'},take:100});}
 @Post() async create(@Body() dto:CountDto,@CurrentUser() u:Principal){
  assertLocation(u,dto.locationId);
  if(new Set(dto.lines.map(x=>x.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variants');
  const balances=await this.db.stockBalance.findMany({where:{locationId:dto.locationId,variantId:{in:dto.lines.map(x=>x.variantId)}}});
  return this.db.stockCount.create({data:{locationId:dto.locationId,reference:dto.reference,lines:{create:dto.lines.map(x=>({variantId:x.variantId,countedQty:x.countedQty,expectedQty:balances.find(b=>b.variantId===x.variantId)?.onHand??0}))}},include:{lines:true}});
 }
 @Post(':id/post') async post(@Param('id') id:string,@CurrentUser() u:Principal){
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`count:${id}`}))`;
   const count=await tx.stockCount.findUniqueOrThrow({where:{id},include:{lines:true}});
   assertLocation(u,count.locationId);
   if(count.status!=='OPEN')throw new ConflictException('Count already finalized');
   for(const line of [...count.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${count.locationId+':'+line.variantId}))`;
    const b=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:count.locationId,variantId:line.variantId}},create:{locationId:count.locationId,variantId:line.variantId},update:{}});
    if(b.onHand!==line.expectedQty)throw new ConflictException('Stock changed since count was created; recount required');
    if(line.countedQty<b.quarantined+b.reservedOnline+b.reservedReplenish+b.safetyBuffer)throw new ConflictException('Count below protected inventory');
    const delta=line.countedQty-b.onHand;
    if(delta){
     await tx.stockBalance.update({where:{id:b.id},data:{onHand:line.countedQty,version:{increment:1}}});
     await tx.stockMovement.create({data:{locationId:count.locationId,variantId:line.variantId,type:'ADJUSTMENT',quantityDelta:delta,referenceType:'STOCK_COUNT',referenceId:id,idempotencyKey:`stock-count:${id}:${line.variantId}`,actorId:u.id,notes:'Approved physical count variance'}});
    }
   }
   await tx.stockCount.update({where:{id},data:{status:'POSTED',postedAt:new Date()}});
   await tx.auditLog.create({data:{actorId:u.id,action:'STOCK_COUNT_POSTED',entityType:'StockCount',entityId:id}});
   return {id,status:'POSTED'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
}
class CustomerDto { @IsString() @MinLength(5) phone!:string; @IsString() @MinLength(2) name!:string; @IsOptional() @IsEmail() email?:string; @IsOptional() @IsBoolean() consentMarketing?:boolean; }
@Controller('retail') @UseGuards(...guards) @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
export class RetailController {
 constructor(private db:Db){}
 @Get('customers') customers(@Query('phone') phone?:string){if(!phone||phone.length<5)throw new BadRequestException('Phone search of 5+ characters required');return this.db.retailCustomer.findMany({where:{phone:{contains:phone}},take:25});}
 @Get('customers/:id/insights') @Roles('SUPER_ADMIN','BRANCH_MANAGER') async insights(@Param('id') id:string){
  const customer=await this.db.retailCustomer.findUniqueOrThrow({where:{id}});
  const orders=await this.db.onlineOrder.findMany({where:{phone:customer.phone},select:{id:true,orderNumber:true,status:true,total:true,createdAt:true},orderBy:{createdAt:'desc'},take:100});
  const delivered=orders.filter(o=>o.status==='DELIVERED');
  return {customer:{id:customer.id,name:customer.name,phone:customer.phone,consentMarketing:customer.consentMarketing},online:{orders:orders.length,deliveredOrders:delivered.length,deliveredValue:delivered.reduce((n,o)=>n+o.total.toNumber(),0).toFixed(2),recentOrders:orders.slice(0,10).map(o=>({...o,total:o.total.toString()})),truncated:orders.length===100},note:'Online orders matched by exact phone. POS sales are not linked to customer records; this is not an omnichannel lifetime value or loyalty points balance.'};
 }
 @Post('customers') customer(@Body() dto:CustomerDto){return this.db.retailCustomer.create({data:dto});}
}
class PriceDto { @IsUUID() variantId!:string; @IsNumber({maxDecimalPlaces:2}) @Min(0) proposedPrice!:number; @IsString() @MinLength(5) @MaxLength(500) reason!:string; }
@Controller('governance') @UseGuards(...guards)
export class GovernanceController {
 constructor(private db:Db){}
 @Get('price-requests') @Roles('SUPER_ADMIN','BRANCH_MANAGER') requests(){return this.db.priceChangeRequest.findMany({orderBy:{createdAt:'desc'},take:200});}
 @Post('price-requests') @Roles('SUPER_ADMIN','BRANCH_MANAGER') request(@Body() dto:PriceDto,@CurrentUser() u:Principal){return this.db.priceChangeRequest.create({data:{variantId:dto.variantId,proposedPrice:new Prisma.Decimal(dto.proposedPrice.toFixed(2)),reason:dto.reason,requestedById:u.id}});}
 @Post('price-requests/:id/approve') @Roles('SUPER_ADMIN') approve(@Param('id') id:string,@CurrentUser() u:Principal){return this.db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`price:${id}`}))`;
  const r=await tx.priceChangeRequest.findUniqueOrThrow({where:{id}});
  if(r.status!=='PENDING')throw new ConflictException('Already reviewed');
  const before=await tx.productVariant.findUniqueOrThrow({where:{id:r.variantId}});
  await tx.productVariant.update({where:{id:r.variantId},data:{price:r.proposedPrice}});
  await tx.priceChangeRequest.update({where:{id},data:{status:'APPROVED',reviewedById:u.id,reviewedAt:new Date()}});
  await tx.auditLog.create({data:{actorId:u.id,action:'PRICE_APPROVED',entityType:'ProductVariant',entityId:r.variantId,before:{price:before.price.toString()},after:{price:r.proposedPrice.toString(),requestId:id}}});
  return {id,status:'APPROVED'};
 });}
 @Get('branch-performance') @Roles('SUPER_ADMIN') async performance(){
  const [locations,sales,balances]=await Promise.all([this.db.location.findMany({where:{type:'BRANCH'},select:{id:true,code:true,name:true}}),this.db.posSale.findMany({where:{status:'ACCEPTED'},select:{locationId:true,total:true,tenders:{select:{type:true,amount:true}}}}),this.db.stockBalance.findMany({select:{locationId:true,onHand:true,quarantined:true,reservedOnline:true,reservedReplenish:true,safetyBuffer:true}})]);
  return locations.map(l=>{const s=sales.filter(x=>x.locationId===l.id),b=balances.filter(x=>x.locationId===l.id);return {branch:l.code,name:l.name,acceptedSales:s.length,grossSales:s.reduce((n,x)=>n+x.total.toNumber(),0).toFixed(2),cash:s.flatMap(x=>x.tenders).filter(t=>t.type==='CASH').reduce((n,t)=>n+t.amount.toNumber(),0).toFixed(2),card:s.flatMap(x=>x.tenders).filter(t=>t.type==='CARD').reduce((n,t)=>n+t.amount.toNumber(),0).toFixed(2),sellableUnits:b.reduce((n,x)=>n+x.onHand-x.quarantined-x.reservedOnline-x.reservedReplenish-x.safetyBuffer,0)};});
 }
}
