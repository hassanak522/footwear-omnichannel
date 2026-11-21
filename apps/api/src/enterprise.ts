import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';
const guards=[JwtAuthGuard,RolesGuard];
class SupplierDto { @IsString() @MinLength(2) code!:string; @IsString() @MinLength(2) name!:string; @IsOptional() @IsString() phone?:string; @IsOptional() @IsEmail() email?:string; }
class UpdateSupplierDto {
 @IsOptional() @IsString() @MinLength(2) code?:string;
 @IsOptional() @IsString() @MinLength(2) name?:string;
 @IsOptional() @IsString() phone?:string;
 @IsOptional() @IsEmail() email?:string;
 @IsOptional() @IsBoolean() active?:boolean;
}
class PoLine { @IsUUID() variantId!:string; @IsInt() @Min(1) quantity!:number; @IsNumber({maxDecimalPlaces:2}) @Min(0) unitCost!:number; }
class PoDto { @IsUUID() supplierId!:string; @IsUUID() warehouseId!:string; @IsString() @MinLength(5) reference!:string; @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>PoLine) lines!:PoLine[]; }
class ReceiveLine { @IsUUID() variantId!:string; @IsInt() @Min(0) quantity!:number; @IsInt() @Min(0) damaged!:number; }
class ReceiveDto { @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>ReceiveLine) lines!:ReceiveLine[]; }
@Controller('purchasing') @UseGuards(...guards) @Roles('SUPER_ADMIN','WAREHOUSE_MANAGER')
export class PurchasingController {
 constructor(private db:Db){}
 @Get('suppliers') suppliers(){return this.db.supplier.findMany({orderBy:{name:'asc'}});}
 @Post('suppliers') supplier(@Body() dto:SupplierDto){return this.db.supplier.create({data:dto});}
 // R3-B1 SUPPLIER MANAGEMENT
 @Patch('suppliers/:id')
 async updateSupplier(
  @Param('id') id:string,
  @Body() dto:UpdateSupplierDto
 ){
  const existing=await this.db.supplier.findUnique({where:{id}});
  if(!existing)throw new NotFoundException('Supplier not found');

  const data:Prisma.SupplierUpdateInput={};

  if(dto.code!==undefined)data.code=dto.code.trim();
  if(dto.name!==undefined)data.name=dto.name.trim();
  if(dto.phone!==undefined)data.phone=dto.phone.trim();
  if(dto.email!==undefined)data.email=dto.email.trim();
  if(dto.active!==undefined)data.active=dto.active;

  if(dto.code!==undefined && dto.code.trim().length<2)
   throw new BadRequestException('Supplier code too short');

  if(dto.name!==undefined && dto.name.trim().length<2)
   throw new BadRequestException('Supplier name too short');

  try{
   return await this.db.supplier.update({where:{id},data});
  }catch(error){
   if(error instanceof Prisma.PrismaClientKnownRequestError){
    if(error.code==='P2002')
     throw new ConflictException('Supplier code already exists');
    if(error.code==='P2025')
     throw new NotFoundException('Supplier not found');
   }
   throw error;
  }
 }
 @Get('orders') orders(@CurrentUser() u:Principal){
  return this.db.purchaseOrder.findMany({
    where:u.roles.includes('SUPER_ADMIN')
      ? {}
      : {warehouseId:{in:u.locations}},
    include:{supplier:true,lines:true},
    orderBy:{createdAt:'desc'},
    take:200
  });
}
 @Post('orders') async order(@Body() dto:PoDto,@CurrentUser() u:Principal){
  assertLocation(u,dto.warehouseId);
  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variants');
  const loc=await this.db.location.findUniqueOrThrow({where:{id:dto.warehouseId}});
  if(loc.type!=='WAREHOUSE'||!loc.active)throw new BadRequestException('Purchase receiving location must be an active warehouse');
  const supplier=await this.db.supplier.findUnique({
   where:{id:dto.supplierId}
  });
  if(!supplier)throw new BadRequestException('Supplier not found');
  if(!supplier.active)
   throw new BadRequestException('Cannot order from inactive supplier');
  // R9_2_RETAIL_INTEGRITY
  const activeVariants=await this.db.productVariant.count({
   where:{
    id:{in:dto.lines.map(l=>l.variantId)},
    active:true
   }
  });

  if(activeVariants!==dto.lines.length)
   throw new BadRequestException('Unknown or inactive product variant');

  return this.db.purchaseOrder.create({data:{supplierId:dto.supplierId,warehouseId:dto.warehouseId,reference:dto.reference,status:'SUBMITTED',lines:{create:dto.lines.map(l=>({variantId:l.variantId,orderedQty:l.quantity,unitCost:new Prisma.Decimal(l.unitCost.toFixed(2))}))}},include:{lines:true}});
 }
 // R3-B1 PURCHASE ORDER CANCELLATION
 @Post('orders/:id/cancel')
 async cancelOrder(
  @Param('id') id:string,
  @CurrentUser() u:Principal
 ){
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${id}`}))`;

   const order=await tx.purchaseOrder.findUnique({
    where:{id},
    include:{lines:true}
   });

   if(!order)throw new NotFoundException('Purchase order not found');

   assertLocation(u,order.warehouseId);

   if(order.status!=='SUBMITTED' && order.status!=='DRAFT')
    throw new ConflictException('Purchase order cannot be cancelled');

   if(order.lines.some(line=>line.receivedQty>0))
    throw new ConflictException(
     'Cannot cancel an order with received quantities'
    );

   const updated=await tx.purchaseOrder.update({
    where:{id},
    data:{status:'CANCELLED'}
   });

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'PURCHASE_ORDER_CANCELLED',
     entityType:'PurchaseOrder',
     entityId:id,
     after:{status:'CANCELLED'}
    }
   });

   return updated;
  },{
   isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
   timeout:15000
  });
 }
 // R3-D1 PURCHASE ORDER RECEIPT HISTORY
 @Get('orders/:id/receipts')
 async receiptHistory(
  @Param('id') id:string,
  @CurrentUser() u:Principal
 ){
  const order=await this.db.purchaseOrder.findUnique({
   where:{id},
   include:{supplier:true,lines:true}
  });

  if(!order)throw new NotFoundException('Purchase order not found');

  assertLocation(u,order.warehouseId);

  const movements=await this.db.stockMovement.findMany({
   where:{
    locationId:order.warehouseId,
    referenceType:'PURCHASE_ORDER',
    referenceId:id,
    type:'SUPPLIER_RECEIPT'
   },
   orderBy:{createdAt:'asc'}
  });

  const receipts=new Map<string,{
   receiptId:string;
   createdAt:Date;
   lines:Array<{
    variantId:string;
    goodQty:number;
    damagedQty:number;
    totalQty:number;
   }>;
  }>();

  for(const movement of movements){
   const metadata=movement.metadata as Record<string,unknown>|null;
   const receiptId=String(metadata?.receiptId || movement.id);

   if(!receipts.has(receiptId)){
    receipts.set(receiptId,{
     receiptId,
     createdAt:movement.createdAt,
     lines:[]
    });
   }

   const goodQty=Number(metadata?.goodQty ?? 0);
   const damagedQty=Number(metadata?.damagedQty ?? 0);

   receipts.get(receiptId)!.lines.push({
    variantId:movement.variantId,
    goodQty,
    damagedQty,
    totalQty:movement.quantityDelta
   });
  }

  return {
   orderId:order.id,
   reference:order.reference,
   status:order.status,
   supplier:order.supplier,
   warehouseId:order.warehouseId,
   receipts:Array.from(receipts.values()),
   totals:{
    ordered:order.lines.reduce((sum,line)=>sum+line.orderedQty,0),
    received:order.lines.reduce((sum,line)=>sum+line.receivedQty,0),
    remaining:order.lines.reduce(
     (sum,line)=>sum+line.orderedQty-line.receivedQty,0
    )
   }
  };
 }
 @Post('orders/:id/receive') async receive(@Param('id') id:string,@Body() dto:ReceiveDto,@CurrentUser() u:Principal){
  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variants');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase:${id}`}))`;
   const order=await tx.purchaseOrder.findUniqueOrThrow({where:{id},include:{lines:true}});
   assertLocation(u,order.warehouseId);

   const warehouse=await tx.location.findUnique({
    where:{id:order.warehouseId}
   });

   if(!warehouse?.active||warehouse.type!=='WAREHOUSE')
    throw new ConflictException('Receiving warehouse is inactive');

   if(order.status==='RECEIVED')throw new ConflictException('Already received');
   if(order.status!=='SUBMITTED')throw new ConflictException('Purchase order not submitted');
   if(dto.lines.length===0)throw new BadRequestException('No receipt lines');
   const byVariant=new Map(order.lines.map(l=>[l.variantId,l]));
   let receivedTotal=0;
   for(const r of dto.lines){
    const line=byVariant.get(r.variantId);
    if(!line)throw new BadRequestException('Variant not on purchase order');
    if(r.quantity+r.damaged>line.orderedQty-line.receivedQty)throw new BadRequestException('Receipt exceeds remaining quantity');
    receivedTotal+=r.quantity+r.damaged;
   }
   if(receivedTotal===0)throw new BadRequestException('Receipt must contain at least one unit');
   const receiptId=randomUUID();
   for(const r of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const line=byVariant.get(r.variantId)!;
    const qty=r.quantity+r.damaged;
    if(!qty)continue;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.warehouseId+':'+line.variantId}))`;
    await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:order.warehouseId,variantId:line.variantId}},create:{locationId:order.warehouseId,variantId:line.variantId,onHand:qty,quarantined:r.damaged},update:{onHand:{increment:qty},quarantined:{increment:r.damaged},version:{increment:1}}});
    await tx.purchaseOrderLine.update({where:{id:line.id},data:{receivedQty:{increment:qty}}});
    await tx.stockMovement.create({data:{locationId:order.warehouseId,variantId:line.variantId,type:'SUPPLIER_RECEIPT',quantityDelta:qty,referenceType:'PURCHASE_ORDER',referenceId:id,idempotencyKey:`purchase:${id}:${receiptId}:${line.variantId}`,actorId:u.id,metadata:{receiptId,goodQty:r.quantity,damagedQty:r.damaged}}});
   }
   const complete=order.lines.every(l=>l.receivedQty+(dto.lines.find(r=>r.variantId===l.variantId)?.quantity??0)+(dto.lines.find(r=>r.variantId===l.variantId)?.damaged??0)===l.orderedQty);
   if(complete)await tx.purchaseOrder.update({where:{id},data:{status:'RECEIVED',receivedAt:new Date()}});
    await tx.auditLog.create({
        data: {
            actorId: u.id,
            action: 'PURCHASE_PARTIAL_RECEIPT',
            entityType: 'PurchaseOrder',
            entityId: id,
            after: JSON.parse(
                JSON.stringify({
                    receiptId,
                    complete,
                    lines: dto.lines,
                })
            ),
        },
    });
   return {id,receiptId,status:complete?'RECEIVED':'SUBMITTED',remaining:order.lines.map(l=>({variantId:l.variantId,remainingQty:l.orderedQty-l.receivedQty-(dto.lines.find(r=>r.variantId===l.variantId)?.quantity??0)-(dto.lines.find(r=>r.variantId===l.variantId)?.damaged??0)}))};
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
  const location=await this.db.location.findUnique({
   where:{id:dto.locationId}
  });

  if(!location?.active||
     !['WAREHOUSE','BRANCH'].includes(location.type))
   throw new BadRequestException('Invalid stock-count location');

  const variants=await this.db.productVariant.count({
   where:{
    id:{in:dto.lines.map(x=>x.variantId)},
    active:true
   }
  });

  if(variants!==dto.lines.length)
   throw new BadRequestException('Unknown or inactive count variant');

  const balances=await this.db.stockBalance.findMany({where:{locationId:dto.locationId,variantId:{in:dto.lines.map(x=>x.variantId)}}});
  return this.db.stockCount.create({data:{locationId:dto.locationId,reference:dto.reference,lines:{create:dto.lines.map(x=>({variantId:x.variantId,countedQty:x.countedQty,expectedQty:balances.find(b=>b.variantId===x.variantId)?.onHand??0}))}},include:{lines:true}});
 }
 @Post(':id/cancel')
 async cancelCount(
  @Param('id') id:string,
  @CurrentUser() u:Principal
 ){
  return this.db.$transaction(async tx=>{
   const count=await tx.stockCount.findUniqueOrThrow({
    where:{id}
   });

   assertLocation(u,count.locationId);

   const result=await tx.stockCount.updateMany({
    where:{id,status:'OPEN'},
    data:{status:'CANCELLED'}
   });

   if(result.count!==1)
    throw new ConflictException('Only open counts can be cancelled');

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'STOCK_COUNT_CANCELLED',
     entityType:'StockCount',
     entityId:id,
     before:{status:'OPEN'},
     after:{status:'CANCELLED'}
    }
   });

   return {id,status:'CANCELLED'};
  });
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
   const varianceLines=count.lines
    .filter(line=>line.countedQty!==line.expectedQty)
    .map(line=>({
     variantId:line.variantId,
     expectedQty:line.expectedQty,
     countedQty:line.countedQty,
     delta:line.countedQty-line.expectedQty
    }));

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'STOCK_COUNT_POSTED',
     entityType:'StockCount',
     entityId:id,
     after:{
      status:'POSTED',
      locationId:count.locationId,
      varianceCount:varianceLines.length,
      varianceLines
     }
    }
   });
   return {id,status:'POSTED'};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
}
class CustomerDto { @IsString() @MinLength(5) phone!:string; @IsString() @MinLength(2) name!:string; @IsOptional() @IsEmail() email?:string; @IsOptional() @IsBoolean() consentMarketing?:boolean; }
@Controller('retail') @UseGuards(...guards) @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
export class RetailController {
 constructor(private db:Db){}
 @Get('customers') customers(@Query('phone') phone?:string){if(!phone||phone.length<5)throw new BadRequestException('Phone search of 5+ characters required');return this.db.retailCustomer.findMany({where:{phone:{contains:phone}},take:25});}
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
