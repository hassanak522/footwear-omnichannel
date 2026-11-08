import { BadRequestException, Body, ConflictException, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { Prisma, SupplierInvoiceStatus } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class CostDto {
 @IsUUID() locationId!:string;
 @IsUUID() variantId!:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) unitCost!:number;
 @IsString() @MaxLength(500) sourceNote!:string;
}
class InvoiceDto {
 @IsUUID() purchaseOrderId!:string;
 @IsString() @MaxLength(120) invoiceNumber!:string;
 @IsDateString() invoiceDate!:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) totalAmount!:number;
 @IsString() @MaxLength(1000) note!:string;
}
class ReviewDto {
 @IsString() status!:string;
 @IsString() @MaxLength(1000) note!:string;
}
@Controller('retail-finance') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class RetailFinanceController {
 constructor(private db:Db){}
 @Post('cost-basis')
 async setCost(@Body() d:CostDto,@CurrentUser() u:Principal){
  assertLocation(u,d.locationId);
  if(!d.sourceNote.trim())throw new BadRequestException('Cost source note required');
  const balance=await this.db.stockBalance.findUnique({where:{locationId_variantId:{locationId:d.locationId,variantId:d.variantId}}});
  if(!balance)throw new BadRequestException('Variant is not stocked at this location');
  return this.db.inventoryCostBasis.upsert({
   where:{locationId_variantId:{locationId:d.locationId,variantId:d.variantId}},
   create:{locationId:d.locationId,variantId:d.variantId,unitCost:new Prisma.Decimal(d.unitCost.toFixed(2)),sourceNote:d.sourceNote.trim(),enteredById:u.id},
   update:{unitCost:new Prisma.Decimal(d.unitCost.toFixed(2)),sourceNote:d.sourceNote.trim(),enteredById:u.id}
  });
 }
 @Get('valuation')
 async valuation(@Query('locationId') locationId:string,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  const [balances,costs]=await Promise.all([
   this.db.stockBalance.findMany({where:{locationId},select:{variantId:true,onHand:true,quarantined:true},take:5000}),
   this.db.inventoryCostBasis.findMany({where:{locationId},take:5000})
  ]);
  const costMap=new Map(costs.map(c=>[c.variantId,c.unitCost]));
  let knownCents=0,unknownCount=0;
  const rows=balances.map(b=>{
   const cost=costMap.get(b.variantId),units=b.onHand;
   if(!cost){unknownCount++;return {variantId:b.variantId,units,quarantined:b.quarantined,unitCost:null,estimatedValue:null};}
   const cents=Math.round(cost.toNumber()*100)*units;knownCents+=cents;
   return {variantId:b.variantId,units,quarantined:b.quarantined,unitCost:cost.toString(),estimatedValue:(cents/100).toFixed(2)};
  });
  return {locationId,currency:'PKR',valuationMethod:'MANUAL_COST_BASIS_ESTIMATE',knownValue:(knownCents/100).toFixed(2),missingCostVariants:unknownCount,truncated:balances.length===5000,rows};
 }
 @Post('supplier-invoices')
 async invoice(@Body() d:InvoiceDto,@CurrentUser() u:Principal){
  const po=await this.db.purchaseOrder.findUnique({where:{id:d.purchaseOrderId}});
  if(!po)throw new BadRequestException('Purchase order not found');
  assertLocation(u,po.warehouseId);
  if(!d.invoiceNumber.trim())throw new BadRequestException('Invoice number required');
  try{return await this.db.supplierInvoice.create({data:{
   purchaseOrderId:po.id,supplierId:po.supplierId,warehouseId:po.warehouseId,
   invoiceNumber:d.invoiceNumber.trim(),invoiceDate:new Date(d.invoiceDate),
   totalAmount:new Prisma.Decimal(d.totalAmount.toFixed(2)),note:d.note.trim(),createdById:u.id
  }});}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('Supplier invoice already recorded');throw e;}
 }
 @Get('supplier-invoices')
 async invoices(@Query('warehouseId') warehouseId:string,@CurrentUser() u:Principal){
  if(!warehouseId)throw new BadRequestException('warehouseId required');
  assertLocation(u,warehouseId);
  return this.db.supplierInvoice.findMany({where:{warehouseId},orderBy:{createdAt:'desc'},take:200});
 }
 @Patch('supplier-invoices/:id/review')
 async review(@Param('id') id:string,@Body() d:ReviewDto,@CurrentUser() u:Principal){
  if(d.status!=='REVIEWED'&&d.status!=='DISPUTED')throw new BadRequestException('Status must be REVIEWED or DISPUTED');
  if(!d.note.trim())throw new BadRequestException('Review note required');
  const item=await this.db.supplierInvoice.findUniqueOrThrow({where:{id}});
  assertLocation(u,item.warehouseId);
  const result=await this.db.supplierInvoice.updateMany({where:{id,status:'DRAFT'},data:{status:d.status as SupplierInvoiceStatus,note:d.note.trim(),reviewedById:u.id,reviewedAt:new Date()}});
  if(result.count!==1)throw new ConflictException('Invoice already reviewed');
  return this.db.supplierInvoice.findUniqueOrThrow({where:{id}});
 }
 @Get('profitability-preview')
 async profitability(@Query('locationId') locationId:string,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  const [sales,costs]=await Promise.all([
   this.db.posSale.findMany({where:{locationId,status:'ACCEPTED'},select:{id:true,total:true,lines:{select:{variantId:true,quantity:true}}},take:5000}),
   this.db.inventoryCostBasis.findMany({where:{locationId}})
  ]);
  const map=new Map(costs.map(c=>[c.variantId,c.unitCost]));
  let salesCents=0,estimatedCostCents=0,unknownLines=0;
  for(const sale of sales){
   salesCents+=Math.round(sale.total.toNumber()*100);
   for(const line of sale.lines){const cost=map.get(line.variantId);if(!cost){unknownLines++;continue;}estimatedCostCents+=Math.round(cost.toNumber()*100)*line.quantity;}
  }
  return {locationId,currency:'PKR',method:'UNADJUSTED_POS_SALES_WITH_CURRENT_MANUAL_COSTS',
   salesTotal:(salesCents/100).toFixed(2),estimatedCostOfSoldUnits:(estimatedCostCents/100).toFixed(2),
   incompleteCostLines:unknownLines,truncated:sales.length===5000,
   warning:'Not accounting profit: excludes returns, fees, taxes, expenses, historical costs, and online sales. Do not use for audited reporting.'};
 }
}
