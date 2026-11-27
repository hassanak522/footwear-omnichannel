import { Prisma } from '@prisma/client';
import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Db } from './db';
import { refundCorrectionEntitlement, authoritativeRefundPosition } from './refund-entitlement';
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

 // D24_FINAL_REFUND_REGISTER

 @Get('refund-positions')
 async refundPositions(
  @CurrentUser() u:Principal,
  @Query('locationId') locationId?:string,
  @Query('cursor') cursor?:string,
  @Query('limit') rawLimit?:string
 ){

  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const limit=rawLimit===undefined?25:Number(rawLimit);

  if(!Number.isInteger(limit)||limit<1||limit>50){
   throw new BadRequestException('Limit must be 1 to 50');
  }

  if(locationId){
   if(!uuid.test(locationId)){
    throw new BadRequestException('Invalid location ID');
   }

   locationId=locationId.toLowerCase();

   assertLocation(u,locationId);
  }

  if(cursor&&!uuid.test(cursor)){
   throw new BadRequestException('Invalid cursor');
  }

  return this.db.$transaction(async tx=>{

   const where:Prisma.PosReturnWhereInput={
    status:'APPROVED',
    ...(locationId
     ?{locationId}
     :u.roles.includes('SUPER_ADMIN')
      ?{}
      :{locationId:{in:u.locations}})
   };

   if(cursor){
    const permitted=await tx.posReturn.findFirst({
     where:{...where,id:cursor.toLowerCase()},
     select:{id:true}
    });

    if(!permitted){
     throw new BadRequestException('Invalid register cursor');
    }
   }

   const returns=await tx.posReturn.findMany({
    where,
    orderBy:[{createdAt:'desc'},{id:'desc'}],
    ...(cursor
     ?{cursor:{id:cursor.toLowerCase()},skip:1}
     :{}),
    take:limit+1,
    select:{
     id:true,
     saleId:true,
     locationId:true,
     createdAt:true
    }
   });

   const page=returns.slice(0,limit);

   const rows=[];

   for(const ret of page){

    const position=
     await authoritativeRefundPosition(tx,ret.id);

    rows.push({
     ...position,
     saleId:ret.saleId,
     createdAt:ret.createdAt
    });
   }

   return {
    currency:'PKR',
    rows,
    hasMore:returns.length>limit,
    nextCursor:returns.length>limit
     ?page[page.length-1].id
     :null,
    calculatedAt:new Date(),
    paymentExecutionAuthorized:false
   };

  },{
   isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,
   timeout:30000
  });
 }

 @Get('refunds')
 async refunds(@CurrentUser() u:Principal){
  const rows=await this.db.refundRecord.findMany({where:u.roles.includes('SUPER_ADMIN')?{}:{locationId:{in:u.locations}},orderBy:{createdAt:'desc'},take:100});
  return rows.map(r=>({...r,amount:r.amount.toString()}));
 }
 @Post('refunds')
 // R10_3D23B_LEGACY_REFUND_GUARD
 async request(@CurrentUser() u:Principal,@Body() d:RefundDto){

  return this.db.$transaction(async tx=>{

   await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
     hashtext(${`pos-refund-settlement:${d.returnId}`})
    )
   `;

   const ret=await tx.posReturn.findUniqueOrThrow({
    where:{id:d.returnId},
    include:{
     lines:true,
     settlements:true,
     exchange:true
    }
   });

   assertLocation(u,ret.locationId);

   if(ret.status!=='APPROVED'){
    throw new ConflictException('Approved return required');
   }

   if(ret.exchange){
    throw new ConflictException(
     'Exchange refunds must use the POS settlement workflow'
    );
   }

   // R10_3D24_48D3G4D4_LEGACY_REFUND_HOLD
   const entitlement =
    await refundCorrectionEntitlement(tx,ret.id);

   if(
    entitlement.correctionHold ||
    entitlement.historicalCents > 0
   ){
    throw new ConflictException(
     'Historical refund correction requires the controlled POS workflow'
    );
   }

   // R10_3D24C_LEGACY_RESERVATION_GUARD
   const reserved=await tx.posRefundAttempt.count({
    where:{
     returnId:ret.id,
     status:{
      notIn:['ACCEPTED','RESOLVED_NO_PAYMENT']
     }
    }
   });

   if(reserved>0){
    throw new ConflictException(
     'A centrally registered POS refund requires reconciliation'
    );
   }

if(ret.settlements.length){
    throw new ConflictException(
     'POS refund settlements already exist for this return'
    );
   }

   const amount=ret.lines.reduce(
    (sum,line)=>
     sum+Math.round(line.refundAmount.toNumber()*100),
    0
   )/100;

   if(amount<=0){
    throw new BadRequestException(
     'Return has no refundable amount'
    );
   }

   return tx.refundRecord.create({
    data:{
     returnId:ret.id,
     locationId:ret.locationId,
     amount,
     method:d.method,
     requestedById:u.id
    }
   }).catch(e=>{
    if(e?.code==='P2002'){
     throw new ConflictException('Refund already registered');
    }

    throw e;
   });

  });
 }

 // R10_3D24_48D3G4D4H_LEGACY_TRANSITION_GUARD
 private async assertLegacyRefundTransition(
  tx:Prisma.TransactionClient,
  id:string,
  u:Principal,
  expectedStatus:string
 ){
  const initial=await tx.refundRecord.findUnique({
   where:{id}
  });

  if(!initial){
   throw new ConflictException('Refund record not found');
  }

  assertLocation(u,initial.locationId);

  await tx.$executeRaw`
   SELECT pg_advisory_xact_lock(
    hashtext(${`pos-refund-settlement:${initial.returnId}`})
   )
  `;

  await tx.$queryRaw`
   SELECT "id" FROM "RefundRecord"
   WHERE "id"=${id}::uuid
   FOR UPDATE
  `;

  const current=await tx.refundRecord.findUniqueOrThrow({
   where:{id}
  });

  if(
   current.returnId!==initial.returnId||
   current.locationId!==initial.locationId||
   current.status!==expectedStatus
  ){
   throw new ConflictException(
    'Refund identity or status changed'
   );
  }

  const ret=await tx.posReturn.findUniqueOrThrow({
   where:{id:current.returnId},
   include:{
    lines:true,
    exchange:true,
    settlements:true
   }
  });

  if(
   ret.locationId!==current.locationId||
   ret.status!=='APPROVED'||
   ret.exchange||
   ret.settlements.length>0
  ){
   throw new ConflictException(
    'Return requires controlled POS reconciliation'
   );
  }

  const entitlement=
   await refundCorrectionEntitlement(tx,ret.id);

  if(
   entitlement.correctionHold||
   entitlement.historicalCents>0||
   entitlement.unresolvedAttemptCount>0
  ){
   throw new ConflictException(
    'Competing refund or financial correction blocks this transition'
   );
  }

  const due=ret.lines.reduce(
   (sum,line)=>sum.plus(line.refundAmount),
   new Prisma.Decimal(0)
  );

  if(
   due.lte(0)||
   !current.amount.eq(due)
  ){
   throw new ConflictException(
    'Legacy refund entitlement mismatch'
   );
  }

  return current;
 }

 @Post('refunds/:id/approve')
 @Roles('SUPER_ADMIN')
 async approve(
  @CurrentUser() u:Principal,
  @Param('id') id:string
 ){
  return this.db.$transaction(async tx=>{
   await this.assertLegacyRefundTransition(
    tx,id,u,'REQUESTED'
   );

   const r=await tx.refundRecord.updateMany({
    where:{id,status:'REQUESTED'},
    data:{
     status:'APPROVED',
     reviewedById:u.id,
     reviewedAt:new Date()
    }
   });

   if(r.count!==1){
    throw new ConflictException(
     'Refund not awaiting approval'
    );
   }

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'REFUND_APPROVED',
     entityType:'RefundRecord',
     entityId:id
    }
   });

   return {id,status:'APPROVED'};
  },{
   isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
   timeout:15000
  });
 }

 @Post('refunds/:id/mark-paid')
 @Roles('SUPER_ADMIN')
 async paid(
  @CurrentUser() u:Principal,
  @Param('id') id:string,
  @Body() d:SettleDto
 ){
  // Administrative confirmation only.
  // This endpoint never transfers funds.

  return this.db.$transaction(async tx=>{
   await this.assertLegacyRefundTransition(
    tx,id,u,'APPROVED'
   );

   const r=await tx.refundRecord.updateMany({
    where:{id,status:'APPROVED'},
    data:{
     status:'PAID',
     reference:d.reference,
     settledById:u.id,
     settledAt:new Date()
    }
   });

   if(r.count!==1){
    throw new ConflictException(
     'Refund not approved or already settled'
    );
   }

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'REFUND_MARKED_PAID',
     entityType:'RefundRecord',
     entityId:id,
     after:{reference:d.reference}
    }
   });

   return {
    id,
    status:'PAID',
    warning:'Manual settlement recorded; no funds were transferred by this API'
   };
  },{
   isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
   timeout:15000
  });
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
