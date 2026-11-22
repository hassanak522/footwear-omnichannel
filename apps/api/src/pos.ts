import { createHash } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Query, ForbiddenException, NotFoundException, Get, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PosTenderType, Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

export async function withPosTransactionRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034';

      if (!retryable) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new ConflictException(
          'POS transaction is busy. Check sale status using the original localSaleId before retrying.',
        );
      }

      const delayMs =
        Math.min(1600, 100 * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 100);

      await new Promise<void>((resolve) =>
        setTimeout(resolve, delayMs),
      );
    }
  }

  throw new ConflictException('POS transaction could not complete.');
}
class RegisterDeviceDto {
 @IsString() @Matches(/^[A-Z0-9_-]{3,50}$/) code!: string;
 @IsUUID() locationId!: string;
}
class OpenShiftDto {
 @IsUUID() deviceId!: string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) openingCash!: number;
}
class CloseShiftDto {
 @IsNumber({maxDecimalPlaces:2}) @Min(0) closingCash!: number;
}
class SaleLineDto {
 @IsUUID() variantId!: string;
 @IsInt() @Min(1) quantity!: number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) unitPrice!: number;
}
class SaleTenderDto {
 @IsEnum(PosTenderType) type!: PosTenderType;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) amount!: number;
 @IsOptional() @IsString() @MaxLength(100) reference?: string;
}
class ReturnLineDto {
 @IsUUID() variantId!: string;
 @IsInt() @Min(1) quantity!: number;
 @IsOptional() @IsBoolean() quarantined?: boolean;
}
class ReturnDto {
 @IsUUID() saleId!: string;
 @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!: string;
 @IsString() @MinLength(3) @MaxLength(500) reason!: string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>ReturnLineDto) lines!: ReturnLineDto[];
}
class RecordPosRefundSettlementDto {
 @IsUUID() returnId!:string;
 @IsString() @MinLength(8) @MaxLength(100)
 idempotencyKey!:string;
 @IsEnum(PosTenderType) method!:PosTenderType;
 @IsNumber({maxDecimalPlaces:2}) @Min(0.01)
 amount!:number;
 @IsOptional() @IsUUID() payoutShiftId?:string;
 @IsOptional() @IsString() @MaxLength(200)
 reference?:string;
}
class PreflightDto {
 @IsUUID() locationId!:string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SaleLineDto) lines!:SaleLineDto[];
}
class QuoteCartDto extends PreflightDto {
 @IsOptional() @IsString() @MaxLength(50) promotionCode?:string;
}
class OnlineDiscountSaleDto extends QuoteCartDto {
 @IsUUID() deviceId!:string;
 @IsUUID() shiftId!:string;
 @IsUUID() localSaleId!:string;
 @IsOptional() @IsUUID() customerId?:string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SaleTenderDto) tenders!:SaleTenderDto[];
}
class ResolveClearanceAttemptDto {
 @IsUUID() deviceId!:string;
 @IsUUID() localSaleId!:string;
 @IsString() @MinLength(20) @MaxLength(1000)
 reason!:string;
 @IsString() @MinLength(5) @MaxLength(200)
 paymentEvidenceReference!:string;
 @IsBoolean()
 externalPaymentReconciled!:boolean;
}
class RegisterClearanceAttemptDto {
 @IsUUID() deviceId!:string;
 @IsUUID() localSaleId!:string;
 @IsUUID() shiftId!:string;
 @IsUUID() locationId!:string;
}
class ClearanceSaleDto {
 @IsUUID() locationId!:string;
 @IsUUID() deviceId!:string;
 @IsUUID() shiftId!:string;
 @IsUUID() localSaleId!:string;
 @IsOptional() @IsUUID() customerId?:string;
 @IsArray() @ArrayMinSize(1)
 @ValidateNested({each:true}) @Type(()=>SaleLineDto)
 lines!:SaleLineDto[];
 @IsArray() @ArrayMinSize(1)
 @ValidateNested({each:true}) @Type(()=>SaleTenderDto)
 tenders!:SaleTenderDto[];
}
class SyncSaleDto {
 @IsOptional() @IsUUID() customerId?: string;
 @IsUUID() deviceId!: string;
 @IsUUID() localSaleId!: string;
 @IsUUID() shiftId!: string;
 @IsDateString() soldAt!: string;
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SaleLineDto) lines!: SaleLineDto[];
 @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SaleTenderDto) tenders!: SaleTenderDto[];
}
const money=(v:number)=>new Prisma.Decimal(v.toFixed(2));
// Deterministic proportional discount allocation in integer cents.
// A line's allocated net amount is divided across units cumulatively, ensuring
// partial returns sum to the exact original net line value without over-refunds.
function discountedLineNets(lines:{variantId:string;quantity:number;unitPrice:Prisma.Decimal}[],discountCents:number){
 const ordered=[...lines].sort((a,b)=>a.variantId.localeCompare(b.variantId));
 const gross=ordered.map(l=>Math.round(l.unitPrice.toNumber()*100)*l.quantity);
 const subtotal=gross.reduce((n,v)=>n+v,0);
 if(subtotal<=0||discountCents<0||discountCents>subtotal)throw new ConflictException('Invalid sale discount allocation');
 const floors=gross.map(g=>Math.floor(g*discountCents/subtotal));
 let remainder=discountCents-floors.reduce((n,v)=>n+v,0);
 const ranks=gross.map((g,i)=>({i,frac:(g*discountCents)%subtotal}))
   .sort((a,b)=>b.frac-a.frac||a.i-b.i);
 for(let j=0;j<remainder;j++)floors[ranks[j].i]++;
 return new Map(ordered.map((l,i)=>[l.variantId,gross[i]-floors[i]]));
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Opt-in policy: set LOYALTY_POINTS_PER_100_PKR to a positive integer only after HQ approval.
const pointsPer100=()=>{const raw=process.env.LOYALTY_POINTS_PER_100_PKR??'0';return /^\d+$/.test(raw)?Math.min(100,Number(raw)):0;};


@Injectable()
export class PosService {
 constructor(private db:Db){}
 private branchAccess(u:Principal,id:string){assertLocation(u,id);}
 async registerDevice(dto:RegisterDeviceDto,u:Principal){
  this.branchAccess(u,dto.locationId);
  const location=await this.db.location.findUnique({where:{id:dto.locationId}});
  if(!location||location.type!=='BRANCH'||!location.active)throw new BadRequestException('Active branch required');
  return this.db.posDevice.create({data:{code:dto.code,locationId:dto.locationId}});
 }
 // R10_2_SHIFT_INTEGRITY
 async openShift(dto:OpenShiftDto,u:Principal){
  const openingCents=Math.round(dto.openingCash*100);

  if(
   !Number.isSafeInteger(openingCents)||
   openingCents<0||
   openingCents>100000000000
  ){
   throw new BadRequestException('Invalid opening cash amount');
  }

  return withPosTransactionRetry(()=>this.db.$transaction(
   async tx=>{
    // Serialize shift opening for this device.
    await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(
      hashtext(${`pos-shift:${dto.deviceId}`})
     )
    `;

    const device=await tx.posDevice.findUnique({
     where:{id:dto.deviceId}
    });

    if(!device||!device.active){
     throw new ConflictException('Active POS device required');
    }

    this.branchAccess(u,device.locationId);

    const location=await tx.location.findUnique({
     where:{id:device.locationId}
    });

    if(!location?.active||location.type!=='BRANCH'){
     throw new ConflictException('Active branch required');
    }

    const active=await tx.posShift.findFirst({
     where:{
      deviceId:dto.deviceId,
      status:'OPEN'
     }
    });

    if(active){
     throw new ConflictException(
      'Device already has an open shift'
     );
    }

    const shift=await tx.posShift.create({
     data:{
      deviceId:dto.deviceId,
      locationId:device.locationId,
      cashierId:u.id,
      openingCash:new Prisma.Decimal(
       (openingCents/100).toFixed(2)
      )
     }
    });

    await tx.auditLog.create({
     data:{
      actorId:u.id,
      action:'POS_SHIFT_OPENED',
      entityType:'PosShift',
      entityId:shift.id,
      after:{
       deviceId:shift.deviceId,
       locationId:shift.locationId,
       openingCash:shift.openingCash.toString(),
       cashierId:u.id
      }
     }
    });

    return shift;
   },{
    isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
    timeout:15000
   }
  ));
 }
async closeShift(id:string,dto:CloseShiftDto,u:Principal){
 return this.db.$transaction(async tx=>{
  await tx.$executeRaw`
   SELECT pg_advisory_xact_lock(hashtext(${`pos-shift-id:${id}`}))
  `;

  const shift = await tx.posShift.findUnique({
    where: { id },
  });

  if (!shift) {
    throw new NotFoundException('POS shift not found');
  }
  this.branchAccess(u,shift.locationId);

  if(
   shift.cashierId!==u.id &&
   !u.roles.includes('SUPER_ADMIN') &&
   !u.roles.includes('BRANCH_MANAGER')
  ){
   throw new ForbiddenException('Not shift owner');
  }

  if(shift.status!=='OPEN'){
   throw new ConflictException('Shift already closed');
  }

  const sales=await tx.posSale.findMany({
   where:{shiftId:id},
   include:{tenders:true}
  });

  // R8_01G_4B8_CENTRAL_SHIFT_BLOCK
  const unresolvedCentralAttempts=
   await tx.posClearanceAttempt.count({
    where:{
     shiftId:id,
     status:{notIn:['ACCEPTED','RESOLVED_NO_SALE']}
    }
   });

  if(unresolvedCentralAttempts>0){
   throw new ConflictException(
    'Shift closing blocked: '+
    unresolvedCentralAttempts+
    ' registered clearance attempt(s) require reconciliation'
   );
  }
  // R8_01G_4B7_SERVER_SHIFT_GUARD
  // Validate server-recorded clearance allocations before shift closure.
  const clearanceAllocations=await tx.posClearanceAllocation.findMany({
   where:{
    saleId:{in:sales.map(s=>s.id)}
   }
  });

  const allocationsBySale=new Map<string,typeof clearanceAllocations>();

  for(const allocation of clearanceAllocations){
   const group=allocationsBySale.get(allocation.saleId)||[];
   group.push(allocation);
   allocationsBySale.set(allocation.saleId,group);
  }

  for(const sale of sales){
   const allocations=allocationsBySale.get(sale.id)||[];

   if(!allocations.length)continue;

   if(sale.status!=='ACCEPTED'){
    throw new ConflictException(
     'Unresolved server-recorded clearance sale blocks shift closing'
    );
   }

   const lines=await tx.posSaleLine.findMany({
    where:{saleId:sale.id}
   });

   const cents=(v:Prisma.Decimal)=>
    v.mul(100)
     .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
     .toNumber();

   const total=cents(sale.total);

   const gross=lines.reduce(
    (sum,l)=>sum+cents(l.unitPrice)*l.quantity,
    0
   );

   const discount=allocations.reduce(
    (sum,a)=>sum+cents(a.discountAmount),
    0
   );

   const tenders=sale.tenders.reduce(
    (sum,t)=>sum+cents(t.amount),
    0
   );

   const lineIds=new Set(lines.map(l=>l.id));

   const uniqueAllocations=
    new Set(allocations.map(a=>a.saleLineId)).size===
    allocations.length;

   const validAllocations=
    uniqueAllocations&&
    allocations.every(a=>{
     const line=lines.find(l=>l.id===a.saleLineId);

     return (
      lineIds.has(a.saleLineId)&&
      !!line&&
      line.variantId===a.variantId&&
      line.quantity===a.quantity&&
      cents(a.grossAmount)===
       cents(line.unitPrice)*line.quantity&&
      cents(a.grossAmount)===
       cents(a.discountAmount)+cents(a.netAmount)
     );
    });

   if(
    !validAllocations||
    discount<=0||
    gross-discount!==total||
    tenders!==total
   ){
    throw new ConflictException(
     'Clearance allocation or tender mismatch. '+
     'Manager reconciliation required before shift closing.'
    );
   }
  }
  // R10_2_UNRESOLVED_SALES_GUARD
  const unresolvedSales=sales.filter(
   sale=>sale.status!=='ACCEPTED'&&
         sale.status!=='STOCK_CONFLICT'
  );

  if(unresolvedSales.length){
   throw new ConflictException(
    'Shift closing blocked: unresolved POS sales require review'
   );
  }

  const movements=await tx.drawerMovement.findMany({
   where:{shiftId:id,status:'APPROVED'}
  });

  const accepted=sales.filter(s=>s.status==='ACCEPTED');

  const cents=(value:Prisma.Decimal)=>
   Math.round(value.toNumber()*100);

  const decimal=(value:number)=>
   new Prisma.Decimal((value/100).toFixed(2));

  const tenderTotal=(type:PosTenderType)=>
   accepted
    .flatMap(s=>s.tenders)
    .filter(t=>t.type===type)
    .reduce((sum,t)=>sum+cents(t.amount),0);

  const cash=tenderTotal('CASH');
  const card=tenderTotal('CARD');
  const other=tenderTotal('OTHER');

  const drawerAdjustment=movements.reduce(
   (sum,m)=>sum+
    (m.type==='CASH_IN'?1:-1)*cents(m.amount),
   0
  );

  const opening=cents(shift.openingCash);
  const counted=cents(money(dto.closingCash));
  const expected=opening+cash+drawerAdjustment;
  const variance=counted-expected;
  const closedAt=new Date();

  const result=await tx.posShift.update({
   where:{id},
   data:{
    status:'CLOSED',
    closedAt,
    closingCash:decimal(counted)
   }
  });

  await tx.posShiftClosingSnapshot.create({
   data:{
    shiftId:id,
    locationId:shift.locationId,
    deviceId:shift.deviceId,
    cashierId:shift.cashierId,
    openingCash:decimal(opening),
    cashSales:decimal(cash),
    cardSales:decimal(card),
    otherSales:decimal(other),
    drawerAdjustment:decimal(drawerAdjustment),
    approvedMovements:movements.length,
    expectedCash:decimal(expected),
    countedCash:decimal(counted),
    variance:decimal(variance),
    acceptedSales:accepted.length,
    conflictedSales:sales.length-accepted.length,
    closedAt
   }
  });

  await tx.auditLog.create({
   data:{
    actorId:u.id,
    action:'POS_SHIFT_CLOSED_SNAPSHOT',
    entityType:'PosShift',
    entityId:id,
    after:{
     expectedCash:decimal(expected).toString(),
     countedCash:decimal(counted).toString(),
     variance:decimal(variance).toString(),
     acceptedSales:accepted.length,
     approvedMovements:movements.length
    }
   }
  });

  return result;
 },{
  isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
  timeout:15000
 });
}

 // R8_01G_4B8_CENTRAL_REGISTRATION
 async registerClearanceAttempt(
  dto:RegisterClearanceAttemptDto,
  u:Principal
 ){
  this.branchAccess(u,dto.locationId);

  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
     hashtext(${`pos-shift-id:${dto.shiftId}`})
    )
   `;

   const shift=await tx.posShift.findUnique({
    where:{id:dto.shiftId}
   });

   if(
    !shift||
    shift.status!=='OPEN'||
    shift.deviceId!==dto.deviceId||
    shift.locationId!==dto.locationId
   ){
    throw new ConflictException(
     'Valid open shift required for clearance registration'
    );
   }

   if(
    shift.cashierId!==u.id&&
    !u.roles.includes('SUPER_ADMIN')&&
    !u.roles.includes('BRANCH_MANAGER')
   ){
    throw new ForbiddenException('Not shift owner');
   }

   const device=await tx.posDevice.findUnique({
    where:{id:dto.deviceId}
   });

   if(
    !device||
    !device.active||
    device.locationId!==dto.locationId
   ){
    throw new BadRequestException('Invalid POS device');
   }

   const existing=await tx.posClearanceAttempt.findUnique({
    where:{
     deviceId_localSaleId:{
      deviceId:dto.deviceId,
      localSaleId:dto.localSaleId
     }
    }
   });

   if(existing){
    if(
     existing.shiftId!==dto.shiftId||
     existing.locationId!==dto.locationId||
     existing.cashierId!==shift.cashierId
    ){
     throw new ConflictException(
      'Clearance transaction identity mismatch'
     );
    }

    return {
     id:existing.id,
     localSaleId:existing.localSaleId,
     status:existing.status,
     duplicate:true
    };
   }

   const attempt=await tx.posClearanceAttempt.create({
    data:{
     deviceId:dto.deviceId,
     localSaleId:dto.localSaleId,
     shiftId:dto.shiftId,
     locationId:dto.locationId,
     cashierId:shift.cashierId,
     status:'REGISTERED'
    }
   });

   return {
    id:attempt.id,
    localSaleId:attempt.localSaleId,
    status:attempt.status,
    duplicate:false
   };
  },{
   isolationLevel:Prisma.TransactionIsolationLevel.Serializable
  });
 }

 // R8_01G_4B8C_MANAGER_RESOLUTION
 // R8_01G_4B8E_RESOLUTION_HISTORY
 async clearanceResolutionHistory(
  locationId:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(locationId)){
   throw new BadRequestException('Valid branch UUID required');
  }

  this.branchAccess(u,locationId);

  const attempts=await this.db.posClearanceAttempt.findMany({
   where:{
    locationId,
    status:'RESOLVED_NO_SALE'
   },
   orderBy:{updatedAt:'desc'},
   take:100,
   select:{
    id:true,
    deviceId:true,
    localSaleId:true,
    shiftId:true,
    cashierId:true,
    locationId:true,
    status:true,
    createdAt:true,
    updatedAt:true
   }
  });

  if(!attempts.length){
   return {
    locationId,
    records:[],
    limit:100
   };
  }

  const audits=await this.db.auditLog.findMany({
   where:{
    entityType:'PosClearanceAttempt',
    action:'POS_CLEARANCE_NO_SALE_RESOLVED',
    entityId:{in:attempts.map(a=>a.id)}
   },
   orderBy:{createdAt:'desc'},
   select:{
    id:true,
    entityId:true,
    actorId:true,
    createdAt:true,
    after:true
   }
  });

  const auditByAttempt=new Map(
   audits.map(a=>[a.entityId,a])
  );

  return {
   locationId,
   limit:100,
   records:attempts.map(attempt=>{
    const audit=auditByAttempt.get(attempt.id);
    const detail=audit?.after;

    const data=detail&&
     typeof detail==='object'&&
     !Array.isArray(detail)
      ?detail as Record<string,unknown>
      :{};

    return {
     ...attempt,
     resolvedAt:audit?.createdAt??null,
     resolvedBy:audit?.actorId??null,
     reason:typeof data.reason==='string'
      ?data.reason:null,
     paymentEvidenceReference:
      typeof data.paymentEvidenceReference==='string'
       ?data.paymentEvidenceReference:null,
     externalPaymentReconciled:
      data.externalPaymentReconciled===true,
     auditId:audit?.id??null,
     auditAvailable:!!audit
    };
   })
  };
 }
 async listClearanceExceptions(
  locationId:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(locationId)){
   throw new BadRequestException('Valid branch UUID required');
  }

  this.branchAccess(u,locationId);

  return this.db.posClearanceAttempt.findMany({
   where:{
    locationId,
    status:{in:['REGISTERED','REVIEW_REQUIRED']}
   },
   orderBy:{createdAt:'asc'},
   take:200,
   select:{
    id:true,
    deviceId:true,
    localSaleId:true,
    shiftId:true,
    locationId:true,
    cashierId:true,
    status:true,
    createdAt:true,
    updatedAt:true
   }
  });
 }

 async resolveClearanceAttempt(
  dto:ResolveClearanceAttemptDto,
  u:Principal
 ){
  if(dto.externalPaymentReconciled!==true){
   throw new BadRequestException(
    'External payment reconciliation confirmation required'
   );
  }

  const reason=dto.reason.trim();
  const evidence=dto.paymentEvidenceReference.trim();

  if(reason.length<20||evidence.length<5){
   throw new BadRequestException(
    'Detailed reason and payment evidence reference required'
   );
  }

  return this.db.$transaction(async tx=>{
   const attempt=await tx.posClearanceAttempt.findUnique({
    where:{
     deviceId_localSaleId:{
      deviceId:dto.deviceId,
      localSaleId:dto.localSaleId
     }
    }
   });

   if(!attempt){
    throw new NotFoundException('Clearance attempt not found');
   }

   this.branchAccess(u,attempt.locationId);

   await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
     hashtext(${`pos-shift-id:${attempt.shiftId}`})
    )
   `;

   const current=await tx.posClearanceAttempt.findUniqueOrThrow({
    where:{id:attempt.id}
   });

   const shift=await tx.posShift.findUnique({
    where:{id:current.shiftId}
   });

   if(!shift||shift.status!=='OPEN'){
    throw new ConflictException(
     'Resolution requires an open shift'
    );
   }

   if(
    current.status!=='REGISTERED'&&
    current.status!=='REVIEW_REQUIRED'
   ){
    throw new ConflictException(
     'Attempt is not eligible for no-sale resolution'
    );
   }

   const sale=await tx.posSale.findUnique({
    where:{
     deviceId_localSaleId:{
      deviceId:dto.deviceId,
      localSaleId:dto.localSaleId
     }
    }
   });

   if(sale){
    throw new ConflictException(
     'A recorded sale exists. Reconcile the sale; '+
     'no-sale resolution is prohibited.'
    );
   }

   const updated=await tx.posClearanceAttempt.update({
    where:{id:current.id},
    data:{status:'RESOLVED_NO_SALE'}
   });

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'POS_CLEARANCE_NO_SALE_RESOLVED',
     entityType:'PosClearanceAttempt',
     entityId:current.id,
     after:{
      previousStatus:current.status,
      newStatus:'RESOLVED_NO_SALE',
      deviceId:current.deviceId,
      localSaleId:current.localSaleId,
      shiftId:current.shiftId,
      locationId:current.locationId,
      reason,
      paymentEvidenceReference:evidence,
      externalPaymentReconciled:true
     }
    }
   });

   return {
    id:updated.id,
    status:updated.status,
    localSaleId:updated.localSaleId,
    action:
     'No-sale exception resolved with manager attestation. '+
     'Original transaction ID must never be reused.'
   };
  },{
   isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
   timeout:15000
  });
 }
 async clearanceAttemptStatus(
  deviceId:string,
  localSaleId:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(deviceId)||!uuid.test(localSaleId)){
   throw new BadRequestException('Valid UUIDs required');
  }

  const device=await this.db.posDevice.findUnique({
   where:{id:deviceId}
  });

  if(!device){
   throw new NotFoundException('Device not found');
  }

  this.branchAccess(u,device.locationId);

  const attempt=await this.db.posClearanceAttempt.findUnique({
   where:{
    deviceId_localSaleId:{deviceId,localSaleId}
   }
  });

  if(!attempt){
   return {
    found:false,
    paymentState:'UNKNOWN',
    action:'Do not collect payment again without reconciliation'
   };
  }

  if(
   attempt.cashierId!==u.id&&
   !u.roles.includes('SUPER_ADMIN')&&
   !u.roles.includes('BRANCH_MANAGER')
  ){
   throw new ForbiddenException('Not shift owner');
  }

  return {
   found:true,
   id:attempt.id,
   deviceId,
   localSaleId,
   shiftId:attempt.shiftId,
   locationId:attempt.locationId,
   status:attempt.status,
   createdAt:attempt.createdAt,
   updatedAt:attempt.updatedAt
  };
 }
 async preflight(dto:PreflightDto,u:Principal){
  this.branchAccess(u,dto.locationId);
  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variants');
  const ids=dto.lines.map(l=>l.variantId);
  const [variants,balances]=await Promise.all([
   this.db.productVariant.findMany({where:{id:{in:ids}},select:{id:true,active:true,price:true}}),
   this.db.stockBalance.findMany({where:{locationId:dto.locationId,variantId:{in:ids}}})
  ]);
  const lines=dto.lines.map(l=>{
   const v=variants.find(v=>v.id===l.variantId);
   const b=balances.find(b=>b.variantId===l.variantId);
   const available=b?b.onHand-b.reservedOnline-b.reservedReplenish-b.quarantined-b.safetyBuffer:0;
   const catalogCents=v?Math.round(v.price.toNumber()*100):null;
   const submittedCents=Math.round(l.unitPrice*100);
   const issues=[...(!v||!v.active?['UNKNOWN_OR_INACTIVE_VARIANT']:[]),
    ...(catalogCents!==null&&catalogCents!==submittedCents?['PRICE_CHANGED']:[]),
    ...(available<l.quantity?['INSUFFICIENT_SELLABLE_STOCK']:[])];
   return {variantId:l.variantId,quantity:l.quantity,submittedUnitPrice:l.unitPrice,
    catalogUnitPrice:catalogCents===null?null:(catalogCents/100).toFixed(2),available,issues};
  });
  return {ok:lines.every(l=>l.issues.length===0),checkedAt:new Date().toISOString(),
   advisoryOnly:true,validForOfflineAcceptance:false,
   warning:'Snapshot only. Stock and catalog prices can change before synchronization. No discount authorized.',lines};
 }
 async quoteCart(dto:QuoteCartDto,u:Principal){
  // Server-owned catalog and stock only; client-provided prices are never trusted for the quote.
  const check=await this.preflight(dto,u);
  const subtotalCents=check.lines.reduce((sum,l)=>sum+(l.catalogUnitPrice===null?0:Math.round(Number(l.catalogUnitPrice)*100)*l.quantity),0);
  const result={...check,subtotal:(subtotalCents/100).toFixed(2),discount:'0.00',total:(subtotalCents/100).toFixed(2),
   promotion:{eligible:false,reason:'No promotion supplied'},
   checkoutEnabled:false,quoteOnly:true,expiresAt:new Date(Date.now()+60_000).toISOString(),
   warning:'Advisory quote only. Does not authorize discounted payment, reserve stock, or record coupon redemption.'};
  const code=dto.promotionCode?.trim().toUpperCase();
  if(!code)return result;
  if(!/^[A-Z0-9_-]{3,50}$/.test(code))throw new BadRequestException('Invalid promotion code format');
  const promo=await this.db.retailPromotion.findUnique({where:{code}});
  const now=new Date();
  if(!promo||promo.status!=='ACTIVE'||promo.startsAt>now||promo.endsAt<=now){
   return {...result,promotion:{eligible:false,reason:'Promotion not active'}};
  }
  if(!['PERCENT','FIXED'].includes(promo.type)||promo.value.lte(0)||promo.type==='PERCENT'&&promo.value.gt(100)){
   return {...result,promotion:{eligible:false,reason:'Promotion configuration invalid'}};
  }
  if(!check.ok)return {...result,promotion:{eligible:false,reason:'Resolve catalog price and stock issues before quoting a discount'}};
  const discountCents=promo.type==='PERCENT'
   ?Math.min(subtotalCents,Math.round(subtotalCents*promo.value.toNumber()/100))
   :Math.min(subtotalCents,Math.round(promo.value.toNumber()*100));
  return {...result,discount:(discountCents/100).toFixed(2),total:((subtotalCents-discountCents)/100).toFixed(2),
   promotion:{eligible:true,reason:'Preview eligible; not authorized for settlement',code:promo.code,title:promo.title}};
 }
 async clearanceSale(dto:ClearanceSaleDto,u:Principal){
  // Disabled by default until clearance rollout is approved.
  if(process.env.POS_CLEARANCE_CHECKOUT_ENABLED!=='true'){
   throw new ForbiddenException(
    'Clearance checkout is not enabled for this deployment'
   );
  }

  this.branchAccess(u,dto.locationId);

  if(dto.lines.length>1000)
   throw new BadRequestException('Too many sale lines');

  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)
   throw new BadRequestException('Duplicate variants');

  const device=await this.db.posDevice.findUnique({
   where:{id:dto.deviceId}
  });

  if(!device||!device.active||device.locationId!==dto.locationId)
   throw new BadRequestException('Invalid POS device or location');

  const location=await this.db.location.findUnique({
   where:{id:dto.locationId}
  });

  if(!location||!location.active||location.type!=='BRANCH')
   throw new BadRequestException('Active retail branch required');

  const payloadHash=hash({
   checkoutType:'CLEARANCE',
   locationId:dto.locationId,
   deviceId:dto.deviceId,
   shiftId:dto.shiftId,
   localSaleId:dto.localSaleId,
   customerId:dto.customerId??null,
   lines:[...dto.lines].sort((a,b)=>
    a.variantId.localeCompare(b.variantId)),
   tenders:dto.tenders
  });

  const toCents=(v:Prisma.Decimal)=>
   v.mul(100)
    .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const fmt=(n:number)=>(n/100).toFixed(2);
  const decimal=(n:number)=>new Prisma.Decimal(fmt(n));

  return withPosTransactionRetry(()=>this.db.$transaction(
   async tx=>{
    await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(
      hashtext(${`pos-shift-id:${dto.shiftId}`})
     )
    `;

    await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(
      hashtext(${`pos-sale:${dto.deviceId}:${dto.localSaleId}`})
     )
    `;

    // R8_01G_4B8B_REGISTERED_CHECKOUT
    const registered=await tx.posClearanceAttempt.findUnique({
     where:{
      deviceId_localSaleId:{
       deviceId:dto.deviceId,
       localSaleId:dto.localSaleId
      }
     }
    });

    if(!registered){
     throw new ConflictException(
      'Clearance attempt must be registered centrally before checkout'
     );
    }

    if(
     registered.shiftId!==dto.shiftId||
     registered.locationId!==dto.locationId
    ){
     throw new ConflictException(
      'Clearance attempt registration identity mismatch'
     );
    }
    // R8_01G_4B11_TERMINAL_CLEARANCE_GUARD
    if(registered.status==='RESOLVED_NO_SALE'){
     throw new ConflictException(
      'Clearance transaction was resolved as no sale. '+
      'Original transaction ID is permanently retired.'
     );
    }

    if(registered.status==='REVIEW_REQUIRED'){
     throw new ConflictException(
      'Clearance transaction requires manager review. '+
      'Checkout is prohibited until reconciliation.'
     );
    }

    const previous=await tx.posSale.findUnique({
     where:{
      deviceId_localSaleId:{
       deviceId:dto.deviceId,
       localSaleId:dto.localSaleId
      }
     }
    });

    if(previous){
     if(previous.cashierId!==u.id&&
        !u.roles.includes('SUPER_ADMIN')&&
        !u.roles.includes('BRANCH_MANAGER'))
      throw new ForbiddenException('Not shift owner');

     if(previous.payloadHash!==payloadHash)
      throw new ConflictException(
       'Sale ID reused with different payload'
      );

     const allocations=await tx.posClearanceAllocation.findMany({
      where:{saleId:previous.id}
     });

     if(
      previous.status==='ACCEPTED'&&
      registered.status!=='ACCEPTED'
     ){
      await tx.posClearanceAttempt.update({
       where:{id:registered.id},
       data:{status:'ACCEPTED'}
      });
     }
     return {
      id:previous.id,
      localSaleId:previous.localSaleId,
      status:previous.status,
      duplicate:true,
      total:previous.total.toString(),
      discount:fmt(allocations.reduce(
       (sum,a)=>sum+toCents(a.discountAmount),0
      ))
     };
    }

    const shift=await tx.posShift.findUnique({
     where:{id:dto.shiftId}
    });

    if(!shift||
       shift.deviceId!==device.id||
       shift.locationId!==device.locationId||
       shift.status!=='OPEN')
     throw new ConflictException('Open POS shift required');

    if(shift.cashierId!==u.id&&
       !u.roles.includes('SUPER_ADMIN')&&
       !u.roles.includes('BRANCH_MANAGER'))
     throw new ForbiddenException('Not shift owner');

    if(registered.cashierId!==shift.cashierId){
     throw new ConflictException(
      'Clearance registration cashier mismatch'
     );
    }

    if(registered.status!=='REGISTERED'){
     throw new ConflictException(
      'Clearance attempt is not available for checkout'
     );
    }
    const now=new Date();

    const ids=dto.lines.map(l=>l.variantId);

    const campaigns=await tx.clearanceCampaign.findMany({
     where:{
      status:'ACTIVE',
      startsAt:{lte:now},
      endsAt:{gt:now},
      branches:{some:{locationId:dto.locationId}},
      variants:{some:{variantId:{in:ids}}}
     },
     include:{
      variants:{select:{variantId:true}}
     },
     orderBy:[{createdAt:'asc'},{id:'asc'}]
    });

    const calculated=[] as {
     variantId:string;
     quantity:number;
     priceCents:number;
     grossCents:number;
     discountCents:number;
     netCents:number;
     campaignId:string|null;
     balanceId:string;
    }[];

    for(const line of [...dto.lines].sort((a,b)=>
     a.variantId.localeCompare(b.variantId))){

     await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
       hashtext(${dto.locationId+':'+line.variantId})
      )
     `;

     const variant=await tx.productVariant.findUnique({
      where:{id:line.variantId},
      include:{product:{select:{active:true}}}
     });

     if(!variant||!variant.active||!variant.product.active)
      throw new ConflictException('Variant inactive');

     const priceCents=toCents(variant.price);
     const submittedCents=Math.round(line.unitPrice*100);

     if(!Number.isSafeInteger(priceCents)||priceCents<0)
      throw new ConflictException('Invalid catalog price');

     if(priceCents!==submittedCents)
      throw new ConflictException(
       'Price changed. Refresh cart before payment'
      );

     const grossCents=priceCents*line.quantity;

     if(!Number.isSafeInteger(grossCents))
      throw new BadRequestException('Sale amount exceeds safe range');

     const balance=await tx.stockBalance.upsert({
      where:{
       locationId_variantId:{
        locationId:dto.locationId,
        variantId:line.variantId
       }
      },
      create:{
       locationId:dto.locationId,
       variantId:line.variantId
      },
      update:{}
     });

     const available=
      balance.onHand-
      balance.reservedOnline-
      balance.reservedReplenish-
      balance.quarantined-
      balance.safetyBuffer;

     if(available<line.quantity)
      throw new ConflictException('Insufficient branch stock');

     const eligible=campaigns
      .filter(c=>
       c.variants.some(v=>v.variantId===line.variantId)&&
       ['PERCENT','FIXED'].includes(c.type)&&
       c.value.gt(0)&&
       (c.type!=='PERCENT'||c.value.lte(100))
      )
      .map(c=>{
       const discount=c.type==='PERCENT'
        ?new Prisma.Decimal(grossCents)
          .mul(c.value)
          .div(100)
          .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
        :toCents(c.value)*line.quantity;

       return {
        campaignId:c.id,
        code:c.code,
        discountCents:Math.min(grossCents,discount)
       };
      })
      .sort((a,b)=>
       b.discountCents-a.discountCents||
       a.code.localeCompare(b.code)
      );

     const best=eligible[0];
     const discountCents=best?.discountCents??0;

     if(!Number.isSafeInteger(discountCents))
      throw new BadRequestException('Invalid discount amount');

     calculated.push({
      variantId:line.variantId,
      quantity:line.quantity,
      priceCents,
      grossCents,
      discountCents,
      netCents:grossCents-discountCents,
      campaignId:best?.campaignId??null,
      balanceId:balance.id
     });
    }

    const subtotal=calculated.reduce(
     (sum,l)=>sum+l.grossCents,0
    );
    const discount=calculated.reduce(
     (sum,l)=>sum+l.discountCents,0
    );
    const due=subtotal-discount;

    if(!Number.isSafeInteger(subtotal)||
       !Number.isSafeInteger(discount)||
       !Number.isSafeInteger(due))
     throw new BadRequestException('Sale total exceeds safe range');

    if(discount<=0)
     throw new ConflictException(
      'No active clearance discount applies'
     );

    const tenderTotal=dto.tenders.reduce(
     (sum,t)=>sum+Math.round(t.amount*100),0
    );

    if(!Number.isSafeInteger(tenderTotal)||tenderTotal!==due)
     throw new BadRequestException(
      'Tender amounts must equal discounted total'
     );

    if(dto.customerId){
     const customer=await tx.retailCustomer.findUnique({
      where:{id:dto.customerId}
     });

     if(!customer)
      throw new BadRequestException('Unknown customer');
    }

    const sale=await tx.posSale.create({
     data:{
      deviceId:device.id,
      localSaleId:dto.localSaleId,
      payloadHash,
      locationId:dto.locationId,
      shiftId:shift.id,
      cashierId:shift.cashierId,
      status:'ACCEPTED',
      soldAt:now,
      total:decimal(due),
      lines:{
       create:calculated.map(l=>({
        variantId:l.variantId,
        quantity:l.quantity,
        unitPrice:decimal(l.priceCents)
       }))
      },
      tenders:{
       create:dto.tenders.map(t=>({
        type:t.type,
        amount:money(t.amount),
        reference:t.reference
       }))
      }
     },
     include:{lines:true}
    });

    for(const l of calculated){
     if(l.campaignId){
      const saleLine=sale.lines.find(
       sl=>sl.variantId===l.variantId
      );

      if(!saleLine)
       throw new ConflictException('Sale line allocation missing');

      await tx.posClearanceAllocation.create({
       data:{
        saleId:sale.id,
        saleLineId:saleLine.id,
        campaignId:l.campaignId,
        variantId:l.variantId,
        quantity:l.quantity,
        grossAmount:decimal(l.grossCents),
        discountAmount:decimal(l.discountCents),
        netAmount:decimal(l.netCents)
       }
      });
     }

     await tx.stockBalance.update({
      where:{id:l.balanceId},
      data:{
       onHand:{decrement:l.quantity},
       version:{increment:1}
      }
     });

     await tx.stockMovement.create({
      data:{
       locationId:dto.locationId,
       variantId:l.variantId,
       type:'SALE',
       quantityDelta:-l.quantity,
       referenceType:'POS_SALE',
       referenceId:sale.id,
       idempotencyKey:`pos:${sale.id}:${l.variantId}`,
       actorId:shift.cashierId
      }
     });
    }

    if(dto.customerId){
     await tx.saleCustomerLink.create({
      data:{
       saleId:sale.id,
       customerId:dto.customerId,
       linkedById:u.id
      }
     });

     const points=Math.floor(due/10000)*pointsPer100();

     if(points>0){
      await tx.loyaltyLedgerEntry.create({
       data:{
        customerId:dto.customerId,
        saleId:sale.id,
        points,
        reason:'SALE_EARN'
       }
      });
     }
    }

    await tx.auditLog.create({
     data:{
      actorId:u.id,
      action:'POS_CLEARANCE_SALE',
      entityType:'PosSale',
      entityId:sale.id,
      after:{
       subtotal:fmt(subtotal),
       discount:fmt(discount),
       total:fmt(due),
       clearanceAllocations:calculated
        .filter(l=>l.campaignId!==null)
        .map(l=>({
         variantId:l.variantId,
         campaignId:l.campaignId,
         discount:fmt(l.discountCents)
        }))
      }
     }
    });

    // Commit sale and central acceptance atomically.
    await tx.posClearanceAttempt.update({
     where:{id:registered.id},
     data:{status:'ACCEPTED'}
    });
    return {
     id:sale.id,
     localSaleId:sale.localSaleId,
     status:'ACCEPTED',
     duplicate:false,
     subtotal:fmt(subtotal),
     discount:fmt(discount),
     total:fmt(due),
     lines:calculated.map(l=>({
      variantId:l.variantId,
      quantity:l.quantity,
      gross:fmt(l.grossCents),
      discount:fmt(l.discountCents),
      net:fmt(l.netCents),
      campaignId:l.campaignId
     }))
    };
   },
   {
    isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
    timeout:15000
   }
  ));
 }
 async onlineDiscountSale(dto:OnlineDiscountSaleDto,u:Principal){
  if(!dto.promotionCode?.trim())throw new BadRequestException('Promotion code required');
  if(new Set(dto.lines.map(l=>l.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variant lines');
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:dto.deviceId}});
  this.branchAccess(u,device.locationId);
  if(!device.active||device.locationId!==dto.locationId)throw new BadRequestException('Invalid device/location');
  const code=dto.promotionCode.trim().toUpperCase();
  if(!/^[A-Z0-9_-]{3,50}$/.test(code))throw new BadRequestException('Invalid promotion code');
  const payloadHash=hash({...dto,promotionCode:code});
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(hashtext(${`pos-shift-id:${dto.shiftId}`}))
     `;

   await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(hashtext(${`pos-sale:${dto.deviceId}:${dto.localSaleId}`}))
     `;
   const previous=await tx.posSale.findUnique({where:{deviceId_localSaleId:{deviceId:dto.deviceId,localSaleId:dto.localSaleId}}});
   if(previous){if(previous.cashierId!==u.id&&!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Not shift owner');
    if(previous.payloadHash!==payloadHash)throw new ConflictException('Sale ID reused with different payload');
    const redemption=await tx.promotionRedemption.findFirst({where:{saleId:previous.id}});
    return {id:previous.id,localSaleId:previous.localSaleId,status:previous.status,duplicate:true,total:previous.total.toString(),discount:redemption?.discountAmount.toString()??'0.00'};
   }
   const shift=await tx.posShift.findUniqueOrThrow({where:{id:dto.shiftId}});
   if(shift.deviceId!==device.id||shift.status!=='OPEN'||shift.locationId!==device.locationId)throw new ConflictException('Open shift required');
   if(shift.cashierId!==u.id&&!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Not shift owner');
   const promo=await tx.retailPromotion.findUnique({where:{code}});
   const now=new Date();
   if(!promo||promo.status!=='ACTIVE'||promo.startsAt>now||promo.endsAt<=now||promo.value.lte(0)||!['PERCENT','FIXED'].includes(promo.type)||promo.type==='PERCENT'&&promo.value.gt(100))throw new ConflictException('Promotion no longer valid');
   const lines=[] as {variantId:string;quantity:number;grossCents:number;priceCents:number;balanceId:string}[];
   for(const line of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${device.locationId+':'+line.variantId}))`;
    const variant=await tx.productVariant.findUnique({where:{id:line.variantId}});
    if(!variant?.active)throw new ConflictException('Variant inactive');
    const priceCents=Math.round(variant.price.toNumber()*100);
    if(priceCents!==Math.round(line.unitPrice*100))throw new ConflictException('Price changed. Refresh cart before payment');
    const balance=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:device.locationId,variantId:line.variantId}},create:{locationId:device.locationId,variantId:line.variantId},update:{}});
    if(balance.onHand-balance.reservedOnline-balance.reservedReplenish-balance.quarantined-balance.safetyBuffer<line.quantity)throw new ConflictException('Insufficient branch stock');
    lines.push({variantId:line.variantId,quantity:line.quantity,grossCents:priceCents*line.quantity,priceCents,balanceId:balance.id});
   }
   const subtotal=lines.reduce((n,l)=>n+l.grossCents,0);
   const discount=promo.type==='PERCENT'?Math.min(subtotal,Math.round(subtotal*promo.value.toNumber()/100)):Math.min(subtotal,Math.round(promo.value.toNumber()*100));
   if(discount<=0)throw new ConflictException('Promotion gives no discount');
   const due=subtotal-discount;
   if(dto.tenders.reduce((n,t)=>n+Math.round(t.amount*100),0)!==due)throw new BadRequestException('Tender amounts must equal discounted total');
   if(dto.customerId){const c=await tx.retailCustomer.findUnique({where:{id:dto.customerId}});if(!c)throw new BadRequestException('Unknown customer');}
   // Allocate discount in cents by largest remainder; keep per-unit prices at catalog values.
   // Discount is stored in PromotionRedemption; return refunds need a later discount-aware allocator.
   const sale=await tx.posSale.create({data:{deviceId:device.id,localSaleId:dto.localSaleId,payloadHash,locationId:device.locationId,shiftId:shift.id,cashierId:shift.cashierId,status:'ACCEPTED',soldAt:now,total:new Prisma.Decimal(due).div(100),lines:{create:lines.map(l=>({variantId:l.variantId,quantity:l.quantity,unitPrice:new Prisma.Decimal(l.priceCents).div(100)}))},tenders:{create:dto.tenders.map(t=>({type:t.type,amount:money(t.amount),reference:t.reference}))}}});
   await tx.promotionRedemption.create({data:{promotionId:promo.id,saleId:sale.id,customerId:dto.customerId,discountAmount:new Prisma.Decimal(discount).div(100)}});
   if(dto.customerId){
    await tx.saleCustomerLink.create({data:{saleId:sale.id,customerId:dto.customerId,linkedById:u.id}});
    const rate=pointsPer100();const points=Math.floor(due/10000)*rate;
    if(points>0)await tx.loyaltyLedgerEntry.create({data:{customerId:dto.customerId,saleId:sale.id,points,reason:'SALE_EARN'}});
   }
   for(const l of lines){
    await tx.stockBalance.update({where:{id:l.balanceId},data:{onHand:{decrement:l.quantity},version:{increment:1}}});
    await tx.stockMovement.create({data:{locationId:device.locationId,variantId:l.variantId,type:'SALE',quantityDelta:-l.quantity,referenceType:'POS_SALE',referenceId:sale.id,idempotencyKey:`pos:${sale.id}:${l.variantId}`,actorId:shift.cashierId}});
   }
   await tx.auditLog.create({data:{actorId:u.id,action:'POS_DISCOUNTED_SALE',entityType:'PosSale',entityId:sale.id,after:{promotionCode:code,subtotal:(subtotal/100).toFixed(2),discount:(discount/100).toFixed(2),total:(due/100).toFixed(2)}}});
   return {id:sale.id,localSaleId:sale.localSaleId,status:'ACCEPTED',duplicate:false,subtotal:(subtotal/100).toFixed(2),discount:(discount/100).toFixed(2),total:(due/100).toFixed(2),promotionCode:code};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
 async syncSale(dto:SyncSaleDto,u:Principal){
  if(new Set(dto.lines.map(x=>x.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate variant lines: aggregate quantities before sync');
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:dto.deviceId}});
  this.branchAccess(u,device.locationId);
  if(!device.active)throw new ForbiddenException('Device disabled');
  const payloadHash=hash(dto);
  const expectedTotal=dto.lines.reduce((sum,l)=>sum+Math.round(l.unitPrice*100)*l.quantity,0);
  const paidTotal=dto.tenders.reduce((sum,t)=>sum+Math.round(t.amount*100),0);
  if(expectedTotal!==paidTotal)throw new BadRequestException('Tender amounts must equal sale total');
  if(new Date(dto.soldAt).getTime()>Date.now()+5*60_000)throw new BadRequestException('Sale timestamp is in the future');
  return withPosTransactionRetry(() => this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-shift-id:${dto.shiftId}`}))`;
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-sale:${dto.deviceId}:${dto.localSaleId}`}))`;
   const existing=await tx.posSale.findUnique({
    where:{
      deviceId_localSaleId:{
        deviceId:dto.deviceId,
        localSaleId:dto.localSaleId
      }
    }
  });
   if(existing){if(existing.cashierId!==u.id&&!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Not shift owner');
    if(existing.payloadHash!==payloadHash)throw new ConflictException('Local sale ID reused with different payload');
    return {id:existing.id,localSaleId:existing.localSaleId,status:existing.status,conflictReason:existing.conflictReason,duplicate:true};
   }
   // Existing local sales may sync after shift close. The shift must still belong to this device.
   const shift=await tx.posShift.findUniqueOrThrow({where:{id:dto.shiftId}});
   if(shift.deviceId!==dto.deviceId||shift.locationId!==device.locationId)throw new BadRequestException('Shift does not belong to this device');
   if(shift.cashierId!==u.id&&!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Not shift owner');
   if(new Date(dto.soldAt)<shift.openedAt || (shift.closedAt && new Date(dto.soldAt)>shift.closedAt))throw new BadRequestException('Sale time outside shift');
   let conflictReason:string|undefined;
   const balances:{variantId:string;id:string;onHand:number;reservedOnline:number;reservedReplenish:number;quarantined:number;safetyBuffer:number}[]=[];
   for(const line of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${device.locationId+':'+line.variantId}))`;
    const variant=await tx.productVariant.findUnique({where:{id:line.variantId}});
    if(!variant||!variant.active)throw new BadRequestException(`Unknown or inactive variant ${line.variantId}`);
    // Opt-in server-authoritative price validation. No coupon/loyalty discount is accepted.
    // An offline catalog with stale prices must be refreshed or reviewed; never silently reprice a paid sale.
    if(process.env.POS_STRICT_CATALOG_PRICING==='true' && Math.round(variant.price.toNumber()*100)!==Math.round(line.unitPrice*100)){
     throw new ConflictException(`Price mismatch for variant ${line.variantId}. Sale not accepted; reconcile payment and refresh catalog before retry.`);
    }
    const balance=await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:device.locationId,variantId:line.variantId}},create:{locationId:device.locationId,variantId:line.variantId},update:{}});
    balances.push({...balance});
    if(balance.onHand-balance.reservedOnline-balance.reservedReplenish-balance.quarantined-balance.safetyBuffer<line.quantity){
     conflictReason=`Insufficient sellable branch stock for variant ${line.variantId}`;
     break;
    }
   }
   const sale=await tx.posSale.create({data:{deviceId:dto.deviceId,localSaleId:dto.localSaleId,payloadHash,locationId:device.locationId,shiftId:dto.shiftId,cashierId:shift.cashierId,status:conflictReason?'STOCK_CONFLICT':'ACCEPTED',conflictReason,soldAt:new Date(dto.soldAt),total:new Prisma.Decimal(expectedTotal).div(100),lines:{create:dto.lines.map(l=>({variantId:l.variantId,quantity:l.quantity,unitPrice:money(l.unitPrice)}))},tenders:{create:dto.tenders.map(t=>({type:t.type,amount:money(t.amount),reference:t.reference}))}}});
   if(!conflictReason && dto.customerId){
    const customer=await tx.retailCustomer.findUnique({where:{id:dto.customerId},select:{id:true}});
    if(!customer)throw new BadRequestException('Selected customer no longer exists');
    await tx.saleCustomerLink.create({data:{saleId:sale.id,customerId:dto.customerId,linkedById:u.id}});
    const rate=pointsPer100();
    if(rate>0){
     const points=Math.floor(expectedTotal/10000)*rate;
     if(points>0)await tx.loyaltyLedgerEntry.create({data:{customerId:dto.customerId,saleId:sale.id,points,reason:'SALE_EARN'}});
    }
   }
   if(!conflictReason){
    for(const line of dto.lines){
     const balance=balances.find(b=>b.variantId===line.variantId)!;
     await tx.stockBalance.update({where:{id:balance.id},data:{onHand:{decrement:line.quantity},version:{increment:1}}});
     await tx.stockMovement.create({data:{locationId:device.locationId,variantId:line.variantId,type:'SALE',quantityDelta:-line.quantity,referenceType:'POS_SALE',referenceId:sale.id,idempotencyKey:`pos:${sale.id}:${line.variantId}`,actorId:shift.cashierId}});
    }
   }
   await tx.auditLog.create({data:{actorId:u.id,action:conflictReason?'POS_STOCK_CONFLICT':'POS_SALE_SYNC',entityType:'PosSale',entityId:sale.id,after:{status:sale.status,deviceId:dto.deviceId,localSaleId:dto.localSaleId}}});
   return {id:sale.id,localSaleId:sale.localSaleId,status:sale.status,conflictReason:sale.conflictReason,duplicate:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000}));
 }
 async returnSale(dto:ReturnDto,u:Principal){
  if(new Set(dto.lines.map(x=>x.variantId)).size!==dto.lines.length)throw new BadRequestException('Duplicate return variants');
  return this.db.$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-return:${dto.saleId}`}))`;
   const existing = await tx.posReturn.findUnique({
    where: { idempotencyKey: dto.idempotencyKey },
    include: { lines: true }
   });

   if (existing) {
    this.branchAccess(u, existing.locationId);

    if (existing.saleId !== dto.saleId) {
     throw new ConflictException('Return key already used');
    }

    const requestedLines = [...dto.lines]
      .map(line => ({
       variantId: line.variantId,
       quantity: line.quantity,
       quarantined: line.quarantined === true
      }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId));

     const storedLines = existing.lines
      .map(line => ({
       variantId: line.variantId,
       quantity: line.quantity,
       quarantined: line.quarantined
      }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId));

     const sameLines =
      requestedLines.length === storedLines.length &&
      requestedLines.every((line, index) =>
       line.variantId === storedLines[index].variantId &&
       line.quantity === storedLines[index].quantity &&
       line.quarantined === storedLines[index].quarantined
      );

     if (existing.reason !== dto.reason || !sameLines) {
      throw new ConflictException(
       'Idempotency key already used with a different return payload'
      );
     }

     return existing;
   }

   const sale = await tx.posSale.findUnique({
    where: { id: dto.saleId },
    include: {
     lines: true,
     returns: { include: { lines: true } }
    }
   });

   if (!sale || sale.status !== 'ACCEPTED') {
    throw new BadRequestException('Accepted original sale required');
   }

   this.branchAccess(u, sale.locationId);
   // CLEARANCE_RETURN_ALLOCATION_V1
   // Use immutable original clearance allocations, never current campaigns.
   const clearance=await tx.posClearanceAllocation.findMany({
    where:{saleId:sale.id}
   });

   const redemption=await tx.promotionRedemption.findFirst({
    where:{saleId:sale.id}
   });

   if(clearance.length>0&&redemption){
    throw new ConflictException(
     'Mixed promotion and clearance discounts require manual review'
    );
   }

   const cents=(value:Prisma.Decimal)=>
    value.mul(100)
     .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
     .toNumber();

   const lineNet=new Map<string,number>();

   if(clearance.length>0){
    const allocations=new Map(
     clearance.map(a=>[a.saleLineId,a])
    );

    if(allocations.size!==clearance.length){
     throw new ConflictException(
      'Duplicate clearance allocations require review'
     );
    }

    for(const sold of sale.lines){
     const allocation=allocations.get(sold.id);

     const gross=cents(sold.unitPrice)*sold.quantity;

     if(!Number.isSafeInteger(gross)||gross<0){
      throw new ConflictException('Invalid original sale amount');
     }

     if(!allocation){
      // Non-clearance lines retain their original catalog value.
      lineNet.set(sold.variantId,gross);
      continue;
     }

     const allocatedGross=cents(allocation.grossAmount);
     const allocatedDiscount=cents(allocation.discountAmount);
     const allocatedNet=cents(allocation.netAmount);

     if(
      allocation.saleId!==sale.id||
      allocation.variantId!==sold.variantId||
      allocation.quantity!==sold.quantity||
      allocatedGross!==gross||
      allocatedDiscount<0||
      allocatedNet<0||
      allocatedGross!==allocatedDiscount+allocatedNet
     ){
      throw new ConflictException(
       'Original clearance allocation inconsistent; manual review required'
      );
     }

     lineNet.set(sold.variantId,allocatedNet);
    }

    if(clearance.some(a=>
      !sale.lines.some(l=>l.id===a.saleLineId)
    )){
     throw new ConflictException(
      'Orphan clearance allocation requires review'
     );
    }

    const calculatedTotal=[...lineNet.values()]
     .reduce((sum,value)=>sum+value,0);

    if(
     !Number.isSafeInteger(calculatedTotal)||
     calculatedTotal!==cents(sale.total)
    ){
     throw new ConflictException(
      'Clearance allocation total does not match original payment'
     );
    }
   }
   else{
    // Preserve existing promotion and standard-sale refund behavior.
    const discountCents=redemption
     ?cents(redemption.discountAmount)
     :0;

    const originalNets=discountedLineNets(
     sale.lines,discountCents
    );

    for(const [variantId,net] of originalNets){
     lineNet.set(variantId,net);
    }
   }
   const records=[];
   for(const line of [...dto.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
    const sold=sale.lines.find(l=>l.variantId===line.variantId);
    if(!sold)throw new BadRequestException('Variant not in original sale');
    const previouslyReturned=sale.returns.flatMap(r=>r.lines).filter(l=>l.variantId===line.variantId).reduce((n,l)=>n+l.quantity,0);
    if(line.quantity>sold.quantity-previouslyReturned)throw new ConflictException('Return exceeds unreturned quantity');
    const net=lineNet.get(line.variantId);
    if(net===undefined)throw new ConflictException('Missing line discount allocation');
    if(
     !Number.isSafeInteger(net)||
     net<0||
     sold.quantity<=0
    ){
     throw new ConflictException('Invalid refundable line amount');
    }

    // Cumulative rounding prevents over-refunds and ensures that
    // multiple partial returns equal the exact original net line value.
    const cumulative=(qty:number)=>
     Math.floor(net*qty/sold.quantity);

    const refundCents=
     cumulative(previouslyReturned+line.quantity)-
     cumulative(previouslyReturned);

    if(
     !Number.isSafeInteger(refundCents)||
     refundCents<0
    ){
     throw new ConflictException('Invalid calculated refund');
    }

    records.push({
     variantId:line.variantId,
     quantity:line.quantity,
     quarantined:line.quarantined===true,
     refundAmount:new Prisma.Decimal(refundCents).div(100)
    });
   }
   const ret=await tx.posReturn.create({data:{saleId:sale.id,locationId:sale.locationId,idempotencyKey:dto.idempotencyKey,reason:dto.reason,approvedById:u.id,lines:{create:records}},include:{lines:true}});
   for(const line of records){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sale.locationId+':'+line.variantId}))`;
    await tx.stockBalance.upsert({where:{locationId_variantId:{locationId:sale.locationId,variantId:line.variantId}},create:{locationId:sale.locationId,variantId:line.variantId,onHand:line.quantity,quarantined:line.quarantined?line.quantity:0},update:{onHand:{increment:line.quantity},...(line.quarantined?{quarantined:{increment:line.quantity}}:{}),version:{increment:1}}});
    await tx.stockMovement.create({data:{locationId:sale.locationId,variantId:line.variantId,type:'SALE_RETURN',quantityDelta:line.quantity,referenceType:'POS_RETURN',referenceId:ret.id,idempotencyKey:`pos-return:${ret.id}:${line.variantId}`,actorId:u.id}});
   }
   // Revoke previously earned points proportionally. Cumulative rounding ensures a full
   // return reverses the entire original award, even across multiple partial returns.
   const linked=await tx.saleCustomerLink.findUnique({where:{saleId:sale.id}});
   if(linked){
    const earned=await tx.loyaltyLedgerEntry.findFirst({where:{saleId:sale.id,reason:'SALE_EARN'}});
    if(earned && earned.points>0){
     const returnedBefore=sale.returns.flatMap(r=>r.lines).reduce((n,l)=>n+l.refundAmount.toNumber(),0);
     const returnedNow=records.reduce((n,l)=>n+l.refundAmount.toNumber(),0);
     const total=sale.total.toNumber();
     if(total>0){
      const before=Math.min(earned.points,Math.floor(earned.points*returnedBefore/total));
      const after=Math.min(earned.points,Math.floor(earned.points*(returnedBefore+returnedNow)/total));
      const reverse=after-before;
      if(reverse>0)await tx.loyaltyLedgerEntry.create({data:{customerId:linked.customerId,returnId:ret.id,points:-reverse,reason:'RETURN_REVERSAL'}});
     }
    }
   }
   await tx.auditLog.create({data:{actorId:u.id,action:'POS_RETURN_APPROVED',entityType:'PosReturn',entityId:ret.id,after:{saleId:sale.id,reason:dto.reason,lines:records.map(x=>({variantId:x.variantId,quantity:x.quantity,quarantined:x.quarantined,refundAmount:x.refundAmount.toString()}))}}});
   return ret;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:15000});
 }
 async clearanceSaleStatus(
  deviceId:string,
  localSaleId:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(deviceId)||!uuid.test(localSaleId)){
   throw new BadRequestException('Valid UUIDs required');
  }

  const device=await this.db.posDevice.findUnique({
   where:{id:deviceId}
  });

  if(!device){
   throw new NotFoundException('POS device not found');
  }

  this.branchAccess(u,device.locationId);

  const sale=await this.db.posSale.findUnique({
   where:{
    deviceId_localSaleId:{
     deviceId,
     localSaleId
    }
   },
   include:{
    lines:true,
    tenders:true
   }
  });

  if(!sale){
   return {
    found:false,
    deviceId,
    localSaleId,
    paymentState:'UNKNOWN',
    action:
     'Sale not found. Do not collect payment again '+
     'until the original attempt is reconciled.'
   };
  }

  if(sale.locationId!==device.locationId){
   throw new ConflictException(
    'Sale location and device location mismatch'
   );
  }

  if(
   sale.cashierId!==u.id&&
   !u.roles.includes('SUPER_ADMIN')&&
   !u.roles.includes('BRANCH_MANAGER')
  ){
   throw new ForbiddenException('Not shift owner');
  }

  const allocations=await this.db.posClearanceAllocation.findMany({
   where:{saleId:sale.id},
   include:{
    campaign:{
     select:{
      id:true,
      code:true,
      title:true
     }
    }
   }
  });

  const cents=(value:Prisma.Decimal)=>
   value.mul(100)
    .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const fmt=(value:number)=>(value/100).toFixed(2);

  const allocationMap=new Map(
   allocations.map(a=>[a.saleLineId,a])
  );

  const lines=sale.lines.map(line=>{
   const allocation=allocationMap.get(line.id);
   const gross=cents(line.unitPrice)*line.quantity;
   const discount=allocation
    ?cents(allocation.discountAmount)
    :0;
   const net=gross-discount;

   return {
    saleLineId:line.id,
    variantId:line.variantId,
    quantity:line.quantity,
    catalogUnitPrice:line.unitPrice.toString(),
    gross:fmt(gross),
    discount:fmt(discount),
    net:fmt(net),
    clearanceCampaign:allocation?{
     id:allocation.campaign.id,
     code:allocation.campaign.code,
     title:allocation.campaign.title
    }:null
   };
  });

  const subtotal=lines.reduce(
   (sum,line)=>sum+Math.round(Number(line.gross)*100),
   0
  );

  const discount=allocations.reduce(
   (sum,a)=>sum+cents(a.discountAmount),
   0
  );

  const net=lines.reduce(
   (sum,line)=>sum+Math.round(Number(line.net)*100),
   0
  );

  const total=cents(sale.total);

  const tenderTotal=sale.tenders.reduce(
   (sum,t)=>sum+cents(t.amount),
   0
  );

  const hasClearance=allocations.length>0;

  const allocationValid=
   hasClearance&&
   allocationMap.size===allocations.length&&
   allocations.every(a=>
    sale.lines.some(l=>
     l.id===a.saleLineId&&
     l.variantId===a.variantId&&
     l.quantity===a.quantity&&
     cents(a.grossAmount)===
      cents(l.unitPrice)*l.quantity&&
     cents(a.grossAmount)===
      cents(a.discountAmount)+cents(a.netAmount)
    )
   )&&
   subtotal-discount===net&&
   net===total&&
   tenderTotal===total;

  if(!hasClearance){
   return {
    found:true,
    clearanceSale:false,
    id:sale.id,
    localSaleId:sale.localSaleId,
    status:sale.status,
    action:
     'This sale has no clearance allocation. '+
     'Use the appropriate standard sale recovery workflow.'
   };
  }

  return {
   found:true,
   clearanceSale:true,
   id:sale.id,
   deviceId,
   localSaleId:sale.localSaleId,
   locationId:sale.locationId,
   shiftId:sale.shiftId,
   status:sale.status,
   soldAt:sale.soldAt,
   currency:'PKR',
   receipt:{
    subtotal:fmt(subtotal),
    discount:fmt(discount),
    total:sale.total.toString(),
    lines,
    tenders:sale.tenders.map(t=>({
     type:t.type,
     amount:t.amount.toString(),
     reference:t.reference
    }))
   },
   integrity:{
    allocationValid,
    tenderMatchesTotal:tenderTotal===total,
    netMatchesTotal:net===total
   },
   paymentState:
    sale.status==='ACCEPTED'&&allocationValid
     ?'SALE_RECORDED'
     :'REVIEW_REQUIRED',
   action:
    sale.status==='ACCEPTED'&&allocationValid
     ?'Sale recorded. Do not charge again. Use receipt details.'
     :'Manager review required. Do not collect payment again.',
   checkoutMode:'ONLINE_ONLY',
   offlineReplayAllowed:false
  };
 }
 async discountedSaleStatus(deviceId:string,localSaleId:string,u:Principal){
  if(!/^[0-9a-fA-F-]{36}$/.test(deviceId)||!/^[0-9a-fA-F-]{36}$/.test(localSaleId))throw new BadRequestException('Valid UUIDs required');
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:deviceId}});
  this.branchAccess(u,device.locationId);
  const sale=await this.db.posSale.findUnique({where:{deviceId_localSaleId:{deviceId,localSaleId}}});
  if(!sale)return {found:false,deviceId,localSaleId,action:'Check connectivity and retry identical checkout payload with same localSaleId; do not charge again.'};
  const redemption = await this.db.promotionRedemption.findFirst({
    where: { saleId: sale.id }
  });

  const promotion = redemption
    ? await this.db.retailPromotion.findUnique({
      where: { id: redemption.promotionId },
      select: { code: true }
     })
    : null;
  return {found:true,id:sale.id,localSaleId:sale.localSaleId,status:sale.status,total:sale.total.toString(),
   promotionCode: promotion?.code ?? null,discount:redemption?.discountAmount.toString()??'0.00',
   action:'Do not resubmit payment. Retrieve receipt using accepted sale details.'};
 }
  async shiftSummary(id:string,u:Principal){
    const shift=await this.db.posShift.findUniqueOrThrow({where:{id}});
    this.branchAccess(u,shift.locationId);
    if (
      shift.cashierId !== u.id &&
      !u.roles.includes('SUPER_ADMIN') &&
      !u.roles.includes('BRANCH_MANAGER')
    ) {
      throw new ForbiddenException('Not shift owner');
    }
    if(shift.status==='CLOSED'){
      const snapshot=await this.db.posShiftClosingSnapshot.findUnique({where:{shiftId:id}});
      if(!snapshot)throw new ConflictException('Closed legacy shift has no verified closing snapshot; manual review required');
      const lateSales=await this.db.posSale.findMany({
        where:{shiftId:id,status:'ACCEPTED',syncedAt:{gt:snapshot.closedAt}},
        select:{id:true,syncedAt:true,tenders:{select:{type:true,amount:true}}}
      });
      const lateTender=(type:PosTenderType)=>lateSales.flatMap(s=>s.tenders)
        .filter(t=>t.type===type).reduce((sum,t)=>sum+Math.round(t.amount.toNumber()*100),0);
      return {
        shiftId:id,status:shift.status,snapshotVerified:true,closedAt:snapshot.closedAt,
        openingCash:snapshot.openingCash,closingCash:snapshot.countedCash,
        acceptedSales:snapshot.acceptedSales,conflictedSales:snapshot.conflictedSales,
        cashSales:snapshot.cashSales,cardSales:snapshot.cardSales,otherSales:snapshot.otherSales,
        drawerAdjustment:snapshot.drawerAdjustment,approvedMovements:snapshot.approvedMovements,
        expectedCash:snapshot.expectedCash,variance:snapshot.variance,
        lateSync:{acceptedSales:lateSales.length,cashSales:(lateTender('CASH')/100).toFixed(2),
          cardSales:(lateTender('CARD')/100).toFixed(2),otherSales:(lateTender('OTHER')/100).toFixed(2),
          note:'Late-sync sales are excluded from immutable closing totals.'}
      };
    }
    const sales=await this.db.posSale.findMany({where:{shiftId:id},include:{tenders:true}});
    const accepted=sales.filter(s=>s.status==='ACCEPTED');
    const total=(type:PosTenderType)=>accepted.flatMap(s=>s.tenders)
      .filter(t=>t.type===type).reduce((sum,t)=>sum+Math.round(t.amount.toNumber()*100),0);
    const movements=await this.db.drawerMovement.findMany({where:{shiftId:id,status:'APPROVED'}});
    const adjustment=movements.reduce((sum,m)=>sum+(m.type==='CASH_IN'?1:-1)*Math.round(m.amount.toNumber()*100),0);
    const expected=Math.round(shift.openingCash.toNumber()*100)+total('CASH')+adjustment;
    return {shiftId:id,status:shift.status,snapshotVerified:false,openingCash:shift.openingCash,
      closingCash:shift.closingCash,acceptedSales:accepted.length,conflictedSales:sales.length-accepted.length,
      cashSales:(total('CASH')/100).toFixed(2),cardSales:(total('CARD')/100).toFixed(2),
      otherSales:(total('OTHER')/100).toFixed(2),drawerAdjustment:(adjustment/100).toFixed(2),
      expectedCash:(expected/100).toFixed(2),variance:null};
  }
 async deviceStatus(deviceId:string,u:Principal){
  const device=await this.db.posDevice.findUniqueOrThrow({where:{id:deviceId},include:{location:{select:{name:true,code:true,active:true}}}});
  this.branchAccess(u,device.locationId);
  const shift=await this.db.posShift.findFirst({where:{deviceId,status:'OPEN'},orderBy:{openedAt:'desc'},select:{id:true,openedAt:true,cashierId:true,openingCash:true}});
  return {id:device.id,code:device.code,active:device.active,locationId:device.locationId,location:device.location,openShift:shift};
 }
 async offlineSaleStatus(deviceId:string,localSaleId:string,u:Principal){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(deviceId)||!uuid.test(localSaleId)){
   throw new BadRequestException('Valid device and local sale UUIDs required');
  }

  const device=await this.db.posDevice.findUniqueOrThrow({
   where:{id:deviceId}
  });
  this.branchAccess(u,device.locationId);

  const sale=await this.db.posSale.findUnique({
   where:{deviceId_localSaleId:{deviceId,localSaleId}},
   select:{
    id:true,
    localSaleId:true,
    status:true,
    conflictReason:true
   }
  });

  if(!sale){
   return {found:false,deviceId,localSaleId};
  }

  return {
   found:true,
   id:sale.id,
   localSaleId:sale.localSaleId,
   status:sale.status,
   conflictReason:sale.conflictReason
  };
 }
  async recordRefundSettlement(
  dto:RecordPosRefundSettlementDto,
  u:Principal
 ){
  const manager=
   u.roles.includes('SUPER_ADMIN')||
   u.roles.includes('BRANCH_MANAGER');

  if(!manager){
   throw new ForbiddenException('Manager authorization required');
  }

  const amountCents=Math.round(dto.amount*100);

  if(!Number.isSafeInteger(amountCents)||amountCents<=0){
   throw new BadRequestException('Invalid settlement amount');
  }

  const reference=dto.reference?.trim()||null;

  if(dto.method!=='CASH'&&!reference){
   throw new BadRequestException(
    'Non-cash refunds require a payment reference'
   );
  }

  if(dto.method==='CASH'&&!dto.payoutShiftId){
   throw new BadRequestException(
    'Cash refunds require an open payout shift'
   );
  }

  if(dto.method!=='CASH'&&dto.payoutShiftId){
   throw new BadRequestException(
    'Only cash refunds may specify a payout shift'
   );
  }

  return withPosTransactionRetry(()=>this.db.$transaction(
   async tx=>{

    // Cash settlements share the same shift lock as shift closing.
    // This prevents a payout from being posted after closing.
    if(dto.method==='CASH'){
     await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
       hashtext(${`pos-shift-id:${dto.payoutShiftId}`})
      )
     `;
    }

    // Serialize all settlement attempts for the same return.
    await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(
      hashtext(${`pos-refund-settlement:${dto.returnId}`})
     )
    `;

    const existing=await tx.posRefundSettlement.findUnique({
     where:{idempotencyKey:dto.idempotencyKey}
    });

    if(existing){
     const previousReturn=await tx.posReturn.findUniqueOrThrow({
      where:{id:existing.returnId}
     });

     this.branchAccess(u,previousReturn.locationId);

     if(
      existing.returnId!==dto.returnId||
      existing.method!==dto.method||
      Math.round(existing.amount.toNumber()*100)!==amountCents||
      (existing.payoutShiftId??null)!==
       (dto.payoutShiftId??null)||
      (existing.reference??null)!==reference
     ){
      throw new ConflictException(
       'Settlement idempotency key reused with different details'
      );
     }

     return {...existing,duplicate:true};
    }

    const ret=await tx.posReturn.findUnique({
     where:{id:dto.returnId},
     include:{
      lines:true,
      settlements:true,
      exchange:true
     }
    });

    if(!ret){
     throw new NotFoundException('Approved return not found');
    }

    this.branchAccess(u,ret.locationId);

    if(ret.status!=='APPROVED'){
     throw new ConflictException('Approved return required');
    }

    if(ret.exchange){
     throw new ConflictException(
      'Exchange-linked return requires separate settlement review'
     );
    }

    // Legacy refund records have an independent payment workflow.
    // Block cross-workflow settlement until explicitly reconciled.
    const legacy=await tx.refundRecord.findUnique({
     where:{returnId:ret.id}
    });

    if(legacy){
     throw new ConflictException(
      'A legacy refund record exists for this return. '+
      'Reconcile it before using POS refund settlement.'
     );
    }

    const dueCents=ret.lines.reduce(
     (sum,line)=>
      sum+Math.round(line.refundAmount.toNumber()*100),
     0
    );

    const settledCents=ret.settlements.reduce(
     (sum,item)=>
      sum+Math.round(item.amount.toNumber()*100),
     0
    );

    if(
     dueCents<=0||
     settledCents+amountCents>dueCents
    ){
     throw new ConflictException(
      'Settlement exceeds the outstanding refund amount'
     );
    }

    let shift:null|{
     id:string;
     locationId:string;
     status:string;
    }=null;

    if(dto.method==='CASH'){
     const found=await tx.posShift.findUnique({
      where:{id:dto.payoutShiftId!}
     });

     if(!found){
      throw new NotFoundException('Payout shift not found');
     }

     if(
      found.locationId!==ret.locationId||
      found.status!=='OPEN'
     ){
      throw new ConflictException(
       'Cash payout requires an open shift at the return branch'
      );
     }

     shift=found;

     // Prevent reusing a return-specific manual cash movement.
     const manualMovement=await tx.drawerMovement.findFirst({
      where:{
       shiftId:shift.id,
       type:'CASH_REFUND',
       status:{in:['PENDING','APPROVED']},
       externalReference:{in:[
        ret.id,
        `POS_RETURN:${ret.id}`
       ]}
      }
     });

     if(manualMovement){
      throw new ConflictException(
       'A cash refund movement already references this return. '+
       'Reconcile it before recording settlement.'
      );
     }
    }

    const amount=new Prisma.Decimal(
     (amountCents/100).toFixed(2)
    );

    const settlement=await tx.posRefundSettlement.create({
     data:{
      returnId:ret.id,
      payoutShiftId:shift?.id??null,
      idempotencyKey:dto.idempotencyKey,
      method:dto.method,
      amount,
      reference,
      settledById:u.id
     }
    });

    if(shift){
     // This movement is approved atomically with the
     // manager-authorized settlement. Do not approve it again.
     const movement=await tx.drawerMovement.create({
      data:{
       locationId:ret.locationId,
       shiftId:shift.id,
       type:'CASH_REFUND',
       amount,
       reason:`POS return refund ${ret.id}`,
       externalReference:`POS_REFUND:${settlement.id}`,
       status:'APPROVED',
       createdById:u.id,
       reviewedById:u.id,
       reviewNote:'Manager-authorized POS refund settlement',
       reviewedAt:new Date()
      }
     });

     await tx.auditLog.create({
      data:{
       actorId:u.id,
       action:'POS_REFUND_DRAWER_MOVEMENT_CREATED',
       entityType:'DrawerMovement',
       entityId:movement.id,
       after:{
        settlementId:settlement.id,
        returnId:ret.id,
        shiftId:shift.id,
        amount:amount.toString(),
        status:'APPROVED'
       }
      }
     });
    }

    await tx.auditLog.create({
     data:{
      actorId:u.id,
      action:'POS_REFUND_SETTLEMENT_RECORDED',
      entityType:'PosRefundSettlement',
      entityId:settlement.id,
      after:{
       returnId:ret.id,
       locationId:ret.locationId,
       method:dto.method,
       amount:amount.toString(),
       reference,
       payoutShiftId:shift?.id??null,
       outstandingAfter:
        ((dueCents-settledCents-amountCents)/100).toFixed(2)
      }
     }
    });

    return {
     ...settlement,
     duplicate:false,
     refundDue:(dueCents/100).toFixed(2),
     refundSettledAfter:
      ((settledCents+amountCents)/100).toFixed(2),
     refundOutstandingAfter:
      ((dueCents-settledCents-amountCents)/100).toFixed(2),
     cashDrawerRecorded:!!shift,
     note:'Administrative record of a refund payout; this API does not transfer funds.'
    };

   },{
    isolationLevel:Prisma.TransactionIsolationLevel.Serializable,
    timeout:15000
   }
  ));
 }
async saleReturnHistory(saleId:string,u:Principal){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saleId)){
   throw new BadRequestException('Valid sale UUID required');
  }

  const sale=await this.db.posSale.findUnique({
   where:{id:saleId},
   include:{
    lines:true,
    returns:{
     include:{
      lines:true,
      settlements:{
       orderBy:{settledAt:'asc'}
      }
     }
    }
   }
  });

  if(!sale)throw new NotFoundException('Sale not found');

  this.branchAccess(u,sale.locationId);

  if(sale.status!=='ACCEPTED'){
   throw new ConflictException('Accepted sale required');
  }

  const lines=sale.lines.map(line=>{
   const returned=sale.returns
    .flatMap(ret=>ret.lines)
    .filter(item=>item.variantId===line.variantId)
    .reduce((sum,item)=>sum+item.quantity,0);

   return {
    variantId:line.variantId,
    soldQuantity:line.quantity,
    returnedQuantity:returned,
    remainingQuantity:Math.max(0,line.quantity-returned),
    unitPrice:line.unitPrice.toString()
   };
  });

  const toCents=(value:Prisma.Decimal)=>
   Math.round(value.toNumber()*100);

  const formatMoney=(value:number)=>
   (value/100).toFixed(2);

  const returns=sale.returns.map(ret=>{
   const due=ret.lines.reduce(
    (sum,line)=>sum+toCents(line.refundAmount),0
   );

   const settled=ret.settlements.reduce(
    (sum,item)=>sum+toCents(item.amount),0
   );

   const outstanding=Math.max(0,due-settled);

   return {
   id:ret.id,
   reason:ret.reason,
   approvedById:ret.approvedById,
   lines:ret.lines.map(line=>({
    variantId:line.variantId,
    quantity:line.quantity,
    quarantined:line.quarantined,
    refundAmount:line.refundAmount.toString()
   })),
   refundDue:formatMoney(due),
   refundSettled:formatMoney(settled),
   refundOutstanding:formatMoney(outstanding),
   settlementStatus:
    settled===0?'UNSETTLED':
    outstanding===0?'SETTLED':'PARTIALLY_SETTLED',
   settlements:ret.settlements.map(item=>({
    id:item.id,
    method:item.method,
    amount:item.amount.toString(),
    reference:item.reference,
    payoutShiftId:item.payoutShiftId,
    settledById:item.settledById,
    settledAt:item.settledAt
   }))
   };
  });

  return {
   saleId:sale.id,
   locationId:sale.locationId,
   lines,
   returns,
   refundPaymentRecorded:returns.some(
    ret=>ret.settlements.length>0
   ),
   refundDueTotal:formatMoney(
    returns.reduce(
     (sum,ret)=>sum+Math.round(Number(ret.refundDue)*100),0
    )
   ),
   refundSettledTotal:formatMoney(
    returns.reduce(
     (sum,ret)=>sum+Math.round(Number(ret.refundSettled)*100),0
    )
   ),
   refundOutstandingTotal:formatMoney(
    returns.reduce(
     (sum,ret)=>sum+Math.round(Number(ret.refundOutstanding)*100),0
    )
   ),
   note:'Refund settlement status reflects recorded payments. Return approval alone does not confirm payment.'
  };
 }
 async listSales(locationId:string,u:Principal){this.branchAccess(u,locationId);return this.db.posSale.findMany({where:{locationId},orderBy:{syncedAt:'desc'},take:100,include:{lines:true,tenders:true}});}
 async retailFinanceSummary(locationId:string,u:Principal){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(locationId||'')){
   throw new BadRequestException('Valid locationId required');
  }

  if(
   !u.roles.includes('SUPER_ADMIN') &&
   !u.roles.includes('BRANCH_MANAGER')
  ){
   throw new ForbiddenException('Manager access required');
  }

  this.branchAccess(u,locationId);

  const limit=100;
  const cents=(v:Prisma.Decimal)=>
   Math.round(v.toNumber()*100);
  const fmt=(n:number)=>(n/100).toFixed(2);

  const [snapshots,returns,settlements,reconciliations]=
   await Promise.all([
    this.db.posShiftClosingSnapshot.findMany({
     where:{locationId},
     orderBy:{closedAt:'desc'},
     take:limit+1
    }),

    this.db.posReturn.findMany({
     where:{locationId},
     orderBy:{createdAt:'desc'},
     take:limit+1,
     include:{
      lines:true,
      settlements:true
     }
    }),

    this.db.posRefundSettlement.findMany({
     where:{return:{locationId}},
     orderBy:{settledAt:'desc'},
     take:limit+1,
     include:{
      return:{
       select:{
        id:true,
        saleId:true,
        locationId:true
       }
      }
     }
    }),

    this.db.cashReconciliation.findMany({
     where:{locationId},
     orderBy:{submittedAt:'desc'},
     take:limit+1
    })
   ]);

  const recentSettlements=settlements.slice(0,limit);

  const cashReferences=recentSettlements
   .filter(s=>s.method==='CASH')
   .map(s=>`POS_REFUND:${s.id}`);

  const movements=cashReferences.length
   ?await this.db.drawerMovement.findMany({
     where:{
      locationId,
      type:'CASH_REFUND',
      externalReference:{in:cashReferences}
     },
     select:{
      id:true,
      shiftId:true,
      amount:true,
      status:true,
      externalReference:true,
      reviewedAt:true
     }
    })
   :[];

  const shiftRows=snapshots.slice(0,limit).map(s=>({
   shiftId:s.shiftId,
   deviceId:s.deviceId,
   cashierId:s.cashierId,
   closedAt:s.closedAt,
   openingCash:s.openingCash.toString(),
   cashSales:s.cashSales.toString(),
   cardSales:s.cardSales.toString(),
   otherSales:s.otherSales.toString(),
   drawerAdjustment:s.drawerAdjustment.toString(),
   approvedMovements:s.approvedMovements,
   expectedCash:s.expectedCash.toString(),
   countedCash:s.countedCash.toString(),
   variance:s.variance.toString(),
   acceptedSales:s.acceptedSales,
   conflictedSales:s.conflictedSales,
   snapshotVerified:true
  }));

  const returnRows=returns.slice(0,limit).map(r=>{
   const due=r.lines.reduce(
    (n,l)=>n+cents(l.refundAmount),0
   );

   const paid=r.settlements.reduce(
    (n,s)=>n+cents(s.amount),0
   );

   const outstanding=Math.max(0,due-paid);

   return {
    returnId:r.id,
    saleId:r.saleId,
    approvedById:r.approvedById,
    createdAt:r.createdAt,
    status:r.status,
    refundDue:fmt(due),
    refundSettled:fmt(paid),
    refundOutstanding:fmt(outstanding),
    settlementStatus:
     paid===0?'UNSETTLED':
     outstanding===0?'SETTLED':'PARTIALLY_SETTLED'
   };
  });

  const settlementRows=recentSettlements.map(s=>{
   const linked=s.method==='CASH'
    ?movements.filter(m=>
      m.externalReference===`POS_REFUND:${s.id}`
     )
    :[];

   const matched=
    linked.length===1 &&
    linked[0].status==='APPROVED' &&
    linked[0].shiftId===s.payoutShiftId &&
    cents(linked[0].amount)===cents(s.amount);

   return {
    settlementId:s.id,
    returnId:s.returnId,
    saleId:s.return.saleId,
    method:s.method,
    amount:s.amount.toString(),
    reference:s.reference,
    payoutShiftId:s.payoutShiftId,
    settledById:s.settledById,
    settledAt:s.settledAt,
    drawerMovements:linked.map(m=>({
     movementId:m.id,
     shiftId:m.shiftId,
     amount:m.amount.toString(),
     status:m.status,
     reviewedAt:m.reviewedAt
    })),
    drawerLinkStatus:s.method!=='CASH'
     ?'NOT_APPLICABLE'
     :matched?'MATCHED':'REVIEW_REQUIRED'
   };
  });

  const reconciliationRows=
   reconciliations.slice(0,limit).map(r=>({
    id:r.id,
    shiftId:r.shiftId,
    status:r.status,
    expectedCash:r.expectedCash.toString(),
    countedCash:r.countedCash.toString(),
    variance:r.variance.toString(),
    submittedAt:r.submittedAt,
    submittedById:r.submittedById,
    reviewedAt:r.reviewedAt,
    reviewedById:r.reviewedById
   }));

  const truncated={
   shifts:snapshots.length>limit,
   returns:returns.length>limit,
   settlements:settlements.length>limit,
   reconciliations:reconciliations.length>limit
  };

  const anyTruncated=Object.values(truncated).some(Boolean);

  const sum=(values:number[])=>
   values.reduce((n,v)=>n+v,0);

  return {
   locationId,
   generatedAt:new Date().toISOString(),
   readOnly:true,
   currency:'PKR',
   rowLimit:limit,
   truncated,
   anyTruncated,
   totalsScope:'DISPLAYED_ROWS_ONLY',
   summary:{
    closedShifts:shiftRows.length,
    netShiftVariance:fmt(
     sum(snapshots.slice(0,limit).map(s=>cents(s.variance)))
    ),
    returnsShown:returnRows.length,
    refundDue:fmt(
     sum(returnRows.map(r=>Math.round(Number(r.refundDue)*100)))
    ),
    refundSettled:fmt(
     sum(returnRows.map(r=>Math.round(Number(r.refundSettled)*100)))
    ),
    refundOutstanding:fmt(
     sum(returnRows.map(r=>Math.round(Number(r.refundOutstanding)*100)))
    ),
    cashSettlementsShown:settlementRows.filter(
     s=>s.method==='CASH'
    ).length,
    cashDrawerLinksRequiringReview:settlementRows.filter(
     s=>s.drawerLinkStatus==='REVIEW_REQUIRED'
    ).length
   },
   shifts:shiftRows,
   returns:returnRows,
   settlements:settlementRows,
   reconciliations:reconciliationRows,
   warning:anyTruncated
    ?'Results are truncated. Totals cover displayed rows only.'
    :'Totals cover displayed rows only, not the full ledger.',
   note:'Historical shift closing snapshots are not recalculated. '+
    'Refund settlements record administrative payout evidence, '+
    'not independent proof of external funds transfer.'
  };
 }

 async historicalRetailFinance(
  locationId:string|undefined,
  from:string|undefined,
  to:string|undefined,
  u:Principal
 ){
  const isHQ=u.roles.includes('SUPER_ADMIN');
  const isManager=u.roles.includes('BRANCH_MANAGER');

  if(!isHQ&&!isManager){
   throw new ForbiddenException('Manager access required');
  }

  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const selectedLocation=locationId?.trim()||undefined;

  if(selectedLocation&&!uuid.test(selectedLocation)){
   throw new BadRequestException('Invalid locationId');
  }

  if(!isHQ&&!selectedLocation){
   throw new BadRequestException(
    'Branch managers must specify an assigned locationId'
   );
  }

  if(selectedLocation){
   this.branchAccess(u,selectedLocation);
  }

  const parseDate=(value:string|undefined,name:string)=>{
   if(!value)return undefined;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value)){
    throw new BadRequestException(
     name+' must use YYYY-MM-DD'
    );
   }
   const date=new Date(value+'T00:00:00.000Z');
   if(
    Number.isNaN(date.getTime())||
    date.toISOString().slice(0,10)!==value
   ){
    throw new BadRequestException('Invalid '+name);
   }
   return date;
  };

  const start=parseDate(from,'from');
  const last=parseDate(to,'to');

  if(start&&last&&start>last){
   throw new BadRequestException('from must not exceed to');
  }

  const end=last
   ?new Date(last.getTime()+86400000)
   :undefined;

  if(start&&end&&
     end.getTime()-start.getTime()>366*86400000){
   throw new BadRequestException(
    'Maximum reporting period is 366 days'
   );
  }

  const dateWhere={
   ...(start?{gte:start}:{}),
   ...(end?{lt:end}:{})
  };

  const hasDateFilter=!!start||!!end;

  const locations=await this.db.location.findMany({
   where:{
    type:'BRANCH',
    active:true,
    ...(selectedLocation?{id:selectedLocation}:{}),
    ...(!isHQ?{id:{in:u.locations}}:{})
   },
   select:{id:true,code:true,name:true},
   orderBy:{code:'asc'}
  });

  if(selectedLocation&&locations.length===0){
   throw new BadRequestException(
    'Selected location is not an active authorized branch'
   );
  }

  const ids=locations.map(l=>l.id);

  if(ids.length===0){
   return {
    generatedAt:new Date().toISOString(),
    currency:'PKR',
    scope:isHQ?'HQ':'BRANCH_MANAGER',
    from:from||null,
    to:to||null,
    timezone:'UTC',
    liabilityScope:'ALL_TIME_CURRENT_OUTSTANDING',
    periodScope:'SHIFT_CLOSINGS_ONLY',
    branches:[],
    totals:{
     closedShifts:0,
     netShiftVariance:'0.00',
     absoluteShiftVariance:'0.00',
     refundDueAllTime:'0.00',
     refundSettledAllTime:'0.00',
     refundOutstandingAllTime:'0.00',
     cashDrawerExceptions:0
    }
   };
  }

  const snapshotGroups=
   await this.db.posShiftClosingSnapshot.groupBy({
    by:['locationId'],
    where:{
     locationId:{in:ids},
     ...(hasDateFilter?{closedAt:dateWhere}:{})
    },
    _count:{_all:true},
    _sum:{variance:true}
   });

  const snapshots=
   await this.db.posShiftClosingSnapshot.findMany({
    where:{
     locationId:{in:ids},
     ...(hasDateFilter?{closedAt:dateWhere}:{})
    },
    select:{locationId:true,variance:true}
   });

  const cents=(v:Prisma.Decimal|null|undefined)=>
   v?Math.round(v.toNumber()*100):0;

  const fmt=(n:number)=>(n/100).toFixed(2);

  // Aggregate ALL historical POS returns.
  // Do not apply the latest-100-record display limit.
  // Each return line and settlement is aggregated separately
  // to prevent multiplication of joined amounts.

  type LiabilityRow={
   locationId:string;
   due:Prisma.Decimal;
   settled:Prisma.Decimal;
   outstanding:Prisma.Decimal;
  };

  const liabilities=await this.db.$queryRaw<LiabilityRow[]>`
   WITH return_due AS (
    SELECT
     r."id",
     r."locationId",
     COALESCE(SUM(l."refundAmount"),0)::numeric AS due
    FROM "PosReturn" r
    LEFT JOIN "PosReturnLine" l
     ON l."returnId"=r."id"
    WHERE r."locationId" IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})
    GROUP BY r."id",r."locationId"
   ),
   return_paid AS (
    SELECT
     s."returnId",
     COALESCE(SUM(s."amount"),0)::numeric AS paid
    FROM "PosRefundSettlement" s
    INNER JOIN "PosReturn" r
     ON r."id"=s."returnId"
    WHERE r."locationId" IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})
    GROUP BY s."returnId"
   )
   SELECT
    d."locationId",
    COALESCE(SUM(d.due),0)::numeric AS due,
    COALESCE(SUM(COALESCE(p.paid,0)),0)::numeric AS settled,
    COALESCE(
     SUM(GREATEST(d.due-COALESCE(p.paid,0),0)),
     0
    )::numeric AS outstanding
   FROM return_due d
   LEFT JOIN return_paid p ON p."returnId"=d."id"
   GROUP BY d."locationId"
  `;

  // Cash settlement records must have exactly one
  // approved drawer movement with matching shift/amount.
  // This is a reporting check, not a payment action.

  type ExceptionRow={
   locationId:string;
   settlementId:string;
   returnId:string;
   payoutShiftId:string|null;
   amount:Prisma.Decimal;
   movementCount:bigint;
   validMovementCount:bigint;
  };

  const cashChecks=await this.db.$queryRaw<ExceptionRow[]>`
   SELECT
    r."locationId",
    s."id" AS "settlementId",
    s."returnId",
    s."payoutShiftId",
    s."amount",
    COUNT(m."id")::bigint AS "movementCount",
    COUNT(m."id") FILTER (
     WHERE m."status"='APPROVED'
      AND m."shiftId"=s."payoutShiftId"
      AND m."amount"=s."amount"
    )::bigint AS "validMovementCount"
   FROM "PosRefundSettlement" s
   INNER JOIN "PosReturn" r ON r."id"=s."returnId"
   LEFT JOIN "DrawerMovement" m
    ON m."locationId"=r."locationId"
    AND m."type"='CASH_REFUND'
    AND m."externalReference"=
     ('POS_REFUND:' || s."id"::text)
   WHERE r."locationId" IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})
    AND s."method"='CASH'
   GROUP BY
    r."locationId",
    s."id",
    s."returnId",
    s."payoutShiftId",
    s."amount"
  `;

  const exceptions=cashChecks.filter(
   r=>Number(r.movementCount)!==1||
      Number(r.validMovementCount)!==1
  );

  const branches=locations.map(location=>{
   const group=snapshotGroups.find(
    g=>g.locationId===location.id
   );

   const liability=liabilities.find(
    l=>l.locationId===location.id
   );

   const branchSnapshots=snapshots.filter(
    s=>s.locationId===location.id
   );

   const branchExceptions=exceptions.filter(
    e=>e.locationId===location.id
   );

   return {
    locationId:location.id,
    code:location.code,
    name:location.name,
    closedShifts:group?group._count._all:0,
    netShiftVariance:fmt(
     cents(group?group._sum.variance:null)
    ),
    absoluteShiftVariance:fmt(
     branchSnapshots.reduce(
      (sum,s)=>sum+Math.abs(cents(s.variance)),0
     )
    ),
    refundDueAllTime:fmt(
     cents(liability?.due)
    ),
    refundSettledAllTime:fmt(
     cents(liability?.settled)
    ),
    refundOutstandingAllTime:fmt(
     cents(liability?.outstanding)
    ),
    cashDrawerExceptions:branchExceptions.length
   };
  });

  const total=(key:
   'netShiftVariance'|
   'absoluteShiftVariance'|
   'refundDueAllTime'|
   'refundSettledAllTime'|
   'refundOutstandingAllTime'
  )=>fmt(branches.reduce(
   (sum,b)=>sum+Math.round(Number(b[key])*100),0
  ));

  return {
   generatedAt:new Date().toISOString(),
   currency:'PKR',
   scope:isHQ?'HQ':'BRANCH_MANAGER',
   from:from||null,
   to:to||null,
   timezone:'UTC',
   liabilityScope:'ALL_TIME_CURRENT_OUTSTANDING',
   periodScope:'SHIFT_CLOSINGS_ONLY',
   branches,
   totals:{
    closedShifts:branches.reduce(
     (sum,b)=>sum+b.closedShifts,0
    ),
    netShiftVariance:total('netShiftVariance'),
    absoluteShiftVariance:total('absoluteShiftVariance'),
    refundDueAllTime:total('refundDueAllTime'),
    refundSettledAllTime:total('refundSettledAllTime'),
    refundOutstandingAllTime:total(
     'refundOutstandingAllTime'
    ),
    cashDrawerExceptions:exceptions.length
   },
   cashDrawerExceptionDetails:exceptions
    .slice(0,100).map(e=>({
     locationId:e.locationId,
     settlementId:e.settlementId,
     returnId:e.returnId,
     payoutShiftId:e.payoutShiftId,
     amount:e.amount.toString(),
     movementCount:Number(e.movementCount),
     validMovementCount:Number(e.validMovementCount)
    })),
   exceptionsTruncated:exceptions.length>100,
   notes:[
    'Refund liabilities include all historical POS returns and recorded POS settlements.',
    'Date filters apply to shift closing snapshots only.',
    'Refund liabilities are current all-time balances, not historical as-of-date balances.',
    'Shift closing variances remain based on immutable snapshots.',
    'UTC dates are used for reporting boundaries.',
    'POS refund records are administrative evidence, not proof of bank settlement.',
    'Legacy refund records and exchange-specific obligations require separate reconciliation.'
   ]
  };
 }


 // R10_2B_FINANCE_REVIEW
 async shiftVarianceReview(locationId:string,u:Principal){
  if(!locationId){
   throw new BadRequestException('Location required');
  }

  this.branchAccess(u,locationId);

  const snapshots=await this.db.posShiftClosingSnapshot.findMany({
   where:{locationId},
   orderBy:{closedAt:'desc'},
   take:200
  });

  const cents=(value:Prisma.Decimal)=>
   Math.round(value.toNumber()*100);

  const rows=snapshots.map(s=>{
   const varianceCents=cents(s.variance);

   return {
    shiftId:s.shiftId,
    deviceId:s.deviceId,
    cashierId:s.cashierId,
    closedAt:s.closedAt,
    openingCash:s.openingCash,
    cashSales:s.cashSales,
    cardSales:s.cardSales,
    otherSales:s.otherSales,
    drawerAdjustment:s.drawerAdjustment,
    expectedCash:s.expectedCash,
    countedCash:s.countedCash,
    variance:s.variance,
    varianceType:varianceCents===0
     ?'BALANCED'
     :varianceCents>0?'OVERAGE':'SHORTAGE',
    requiresReview:varianceCents!==0,
    acceptedSales:s.acceptedSales,
    conflictedSales:s.conflictedSales,
    approvedMovements:s.approvedMovements
   };
  });

  return {
   locationId,
   generatedAt:new Date().toISOString(),
   truncated:snapshots.length===200,
   totals:{
    closedShifts:rows.length,
    balanced:rows.filter(
     r=>r.varianceType==='BALANCED'
    ).length,
    overages:rows.filter(
     r=>r.varianceType==='OVERAGE'
    ).length,
    shortages:rows.filter(
     r=>r.varianceType==='SHORTAGE'
    ).length,
    requiringReview:rows.filter(
     r=>r.requiresReview
    ).length
   },
   rows
  };
 }

 async refundSettlementReview(locationId:string,u:Principal){
  if(!locationId){
   throw new BadRequestException('Location required');
  }

  this.branchAccess(u,locationId);

  const returns=await this.db.posReturn.findMany({
   where:{locationId},
   include:{
    lines:true,
    settlements:true
   },
   orderBy:{createdAt:'desc'},
   take:200
  });

  const cents=(value:Prisma.Decimal)=>
   Math.round(value.toNumber()*100);

  const rows=returns.map(ret=>{
   const dueCents=ret.lines.reduce(
    (sum,line)=>sum+cents(line.refundAmount),0
   );

   const settledCents=ret.settlements.reduce(
    (sum,item)=>sum+cents(item.amount),0
   );

   const outstandingCents=Math.max(
    0,dueCents-settledCents
   );

   return {
    returnId:ret.id,
    saleId:ret.saleId,
    status:ret.status,
    createdAt:ret.createdAt,
    refundDue:(dueCents/100).toFixed(2),
    settled:(settledCents/100).toFixed(2),
    outstanding:(outstandingCents/100).toFixed(2),
    requiresReview:outstandingCents>0,
    settlements:ret.settlements.map(s=>({
     id:s.id,
     method:s.method,
     amount:s.amount,
     reference:s.reference,
     payoutShiftId:s.payoutShiftId
    }))
   };
  });

  return {
   locationId,
   generatedAt:new Date().toISOString(),
   truncated:returns.length===200,
   totals:{
    returns:rows.length,
    requiringReview:rows.filter(
     r=>r.requiresReview
    ).length,
    fullySettled:rows.filter(
     r=>!r.requiresReview
    ).length
   },
   rows,
   note:'Outstanding values are based on POS refund settlements only. Legacy refund records require separate reconciliation.'
  };
 }

 // R10_3A_BRANCH_RECONCILIATION
 async branchReconciliation(
  locationId:string,
  from:string,
  to:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(locationId||'')){
   throw new BadRequestException('Valid locationId required');
  }

  this.branchAccess(u,locationId);

  const parse=(value:string,name:string)=>{
   if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')){
    throw new BadRequestException(name+' must use YYYY-MM-DD');
   }

   const date=new Date(value+'T00:00:00.000Z');

   if(
    Number.isNaN(date.getTime())||
    date.toISOString().slice(0,10)!==value
   ){
    throw new BadRequestException('Invalid '+name);
   }

   return date;
  };

  const start=parse(from,'from');
  const last=parse(to,'to');
  const end=new Date(last.getTime()+86400000);

  if(
   end<=start||
   end.getTime()-start.getTime()>31*86400000
  ){
   throw new BadRequestException(
    'Date range must cover 1 to 31 UTC days'
   );
  }

  const dateRange={gte:start,lt:end};

  const [
   location,
   sales,
   snapshots,
   shifts,
   movements,
   returns
  ]=await Promise.all([
   this.db.location.findUnique({
    where:{id:locationId},
    select:{id:true,code:true,name:true,type:true}
   }),
   this.db.posSale.findMany({
    where:{locationId,soldAt:dateRange},
    select:{
     id:true,
     shiftId:true,
     status:true,
     total:true,
     syncedAt:true,
     tenders:{
      select:{type:true,amount:true}
     }
    }
   }),
   this.db.posShiftClosingSnapshot.findMany({
    where:{locationId,closedAt:dateRange},
    orderBy:{closedAt:'desc'}
   }),
   this.db.posShift.findMany({
    where:{
     locationId,
     OR:[
      {openedAt:dateRange},
      {status:'OPEN'}
     ]
    },
    select:{
     id:true,
     deviceId:true,
     cashierId:true,
     status:true,
     openedAt:true,
     closedAt:true
    }
   }),
   this.db.drawerMovement.findMany({
    where:{locationId,createdAt:dateRange},
    select:{
     id:true,
     shiftId:true,
     type:true,
     status:true,
     amount:true
    }
   }),
   this.db.posReturn.findMany({
    where:{locationId,createdAt:dateRange},
    include:{
     lines:true,
     settlements:true
    }
   })
  ]);

  if(!location||location.type!=='BRANCH'){
   throw new BadRequestException('Branch location required');
  }

  const cents=(value:Prisma.Decimal)=>
   value.mul(100)
    .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const amount=(value:number)=>
   (value/100).toFixed(2);

  const accepted=sales.filter(s=>s.status==='ACCEPTED');
  const conflicted=sales.filter(
   s=>s.status==='STOCK_CONFLICT'
  );

  const unresolved=sales.filter(
   s=>s.status!=='ACCEPTED'&&
      s.status!=='STOCK_CONFLICT'
  );

  const tenderTotals={
   CASH:0,
   CARD:0,
   OTHER:0
  };

  for(const sale of accepted){
   for(const tender of sale.tenders){
    const value=cents(tender.amount);

    if(tender.type==='CASH')tenderTotals.CASH+=value;
    else if(tender.type==='CARD')tenderTotals.CARD+=value;
    else tenderTotals.OTHER+=value;
   }
  }

  const acceptedSalesCents=accepted.reduce(
   (sum,sale)=>sum+cents(sale.total),0
  );

  const tenderCents=
   tenderTotals.CASH+
   tenderTotals.CARD+
   tenderTotals.OTHER;

  const shiftRows=snapshots.map(s=>({
   shiftId:s.shiftId,
   deviceId:s.deviceId,
   cashierId:s.cashierId,
   closedAt:s.closedAt,
   expectedCash:amount(cents(s.expectedCash)),
   countedCash:amount(cents(s.countedCash)),
   variance:amount(cents(s.variance)),
   acceptedSales:s.acceptedSales,
   conflictedSales:s.conflictedSales
  }));

  const varianceCents=snapshots.reduce(
   (sum,s)=>sum+cents(s.variance),0
  );

  const pendingMovements=movements.filter(
   m=>m.status==='PENDING'
  );

  const openShifts=shifts.filter(
   s=>s.status==='OPEN'
  );

  const refundRows=returns.map(ret=>{
   const due=ret.lines.reduce(
    (sum,line)=>sum+cents(line.refundAmount),0
   );

   const settled=ret.settlements.reduce(
    (sum,item)=>sum+cents(item.amount),0
   );

   return {
    returnId:ret.id,
    saleId:ret.saleId,
    status:ret.status,
    refundDue:amount(due),
    settled:amount(settled),
    outstanding:amount(Math.max(0,due-settled)),
    outstandingCents:Math.max(0,due-settled)
   };
  });

  const outstandingRefunds=refundRows.filter(
   r=>r.outstandingCents>0
  );

  const lateSyncedSales=accepted.filter(
   sale=>{
    const snapshot=snapshots.find(
     s=>s.shiftId===sale.shiftId
    );

    return !!snapshot&&sale.syncedAt>snapshot.closedAt;
   }
  );

  const issues:string[]=[];

  if(openShifts.length)
   issues.push('OPEN_SHIFTS');

  if(pendingMovements.length)
   issues.push('PENDING_DRAWER_MOVEMENTS');

  if(unresolved.length)
   issues.push('UNRESOLVED_SALES');

  if(conflicted.length)
   issues.push('STOCK_CONFLICTS');

  if(varianceCents!==0)
   issues.push('CASH_VARIANCE');

  if(outstandingRefunds.length)
   issues.push('OUTSTANDING_REFUNDS');

  if(acceptedSalesCents!==tenderCents)
   issues.push('TENDER_MISMATCH');

  if(lateSyncedSales.length)
   issues.push('LATE_SYNCED_SALES');

  const result={
   location,
   period:{from,to,timezone:'UTC'},
   generatedAt:new Date().toISOString(),
   status:issues.length
    ?'REVIEW_REQUIRED'
    :'NO_DETECTED_EXCEPTIONS',
   issues,
   sales:{
    accepted:accepted.length,
    conflicted:conflicted.length,
    unresolved:unresolved.length,
    acceptedTotal:amount(acceptedSalesCents),
    tenderTotal:amount(tenderCents),
    tenderDifference:amount(
     acceptedSalesCents-tenderCents
    ),
    tenders:{
     cash:amount(tenderTotals.CASH),
     card:amount(tenderTotals.CARD),
     other:amount(tenderTotals.OTHER)
    },
    lateSynced:lateSyncedSales.length
   },
   shifts:{
    open:openShifts.length,
    closedInPeriod:snapshots.length,
    totalVariance:amount(varianceCents),
    rows:shiftRows
   },
   drawer:{
    pendingMovements:pendingMovements.length,
    movementsInPeriod:movements.length
   },
   refunds:{
    returnsInPeriod:refundRows.length,
    outstandingCount:outstandingRefunds.length,
    outstandingAmount:amount(
     outstandingRefunds.reduce(
      (sum,r)=>sum+r.outstandingCents,0
     )
    ),
    rows:refundRows.map(
     ({outstandingCents,...row})=>row
    )
   },
   limitations:[
    'Sales are selected by soldAt; closing snapshots by closedAt.',
    'Refunds are selected by return creation date, not settlement date.',
    'Open shifts may include shifts opened before the reporting period.',
    'Legacy refunds and external bank settlements are not reconciled.',
    'NO_DETECTED_EXCEPTIONS is not a financial clearance certificate.'
   ]
  };

  return result;
 }


 // R10_3D7_HQ_OVERSIGHT
 async hqClosingOversight(u:Principal){
  if(!u.roles.includes('SUPER_ADMIN')){
   throw new ForbiddenException('HQ administrator access required');
  }

  const branches=await this.db.location.findMany({
   where:{type:'BRANCH',active:true},
   select:{id:true,code:true,name:true},
   orderBy:{code:'asc'}
  });

  const now=new Date();
  const today=new Date(Date.UTC(
   now.getUTCFullYear(),
   now.getUTCMonth(),
   now.getUTCDate()
  ));

  // Seven completed UTC dates; today's closing is not due yet.
  const dates=Array.from({length:7},(_,i)=>{
   const d=new Date(today);
   d.setUTCDate(d.getUTCDate()-(i+1));
   return d.toISOString().slice(0,10);
  });

  const from=new Date(dates[6]+'T00:00:00.000Z');
  const ids=branches.map(b=>b.id);

  if(ids.length===0){
   return {
    generatedAt:now.toISOString(),
    dates,
    summary:{
     branches:0,
     expectedClosings:0,
     acknowledgedClosings:0,
     missingClosings:0,
     openIncidents:0
    },
    branches:[]
   };
  }

  const [reviews,incidents]=await Promise.all([
   this.db.branchClosingReview.findMany({
    where:{
     locationId:{in:ids},
     closingDate:{gte:from,lt:today}
    },
    select:{
     locationId:true,
     closingDate:true,
     status:true,
     signedAt:true
    }
   }),
   this.db.branchClosingDriftIncident.findMany({
    where:{
     locationId:{in:ids},
     status:{not:'RESOLVED'}
    },
    select:{
     locationId:true,
     status:true,
     changedSections:true,
     currentIssues:true,
     closingDate:true
    }
   })
  ]);

  const rows=branches.map(branch=>{
   const branchReviews=reviews.filter(
    r=>r.locationId===branch.id
   );
   const branchIncidents=incidents.filter(
    i=>i.locationId===branch.id
   );

   const reviewDates=new Set(
    branchReviews.map(r=>
     r.closingDate.toISOString().slice(0,10)
    )
   );

   return {
    locationId:branch.id,
    code:branch.code,
    name:branch.name,
    expectedClosings:dates.length,
    acknowledgedClosings:reviewDates.size,
    missingClosings:dates.filter(
     date=>!reviewDates.has(date)
    ).length,
    missingDates:dates.filter(
     date=>!reviewDates.has(date)
    ),
    openIncidents:branchIncidents.length,
    incidentStatuses:branchIncidents.reduce(
     (acc:Record<string,number>,incident)=>{
      acc[incident.status]=(acc[incident.status]||0)+1;
      return acc;
     },
     {}
    ),
    lastAcknowledgedAt:branchReviews
     .map(r=>r.signedAt.toISOString())
     .sort()
     .reverse()[0]||null
   };
  });

  return {
   generatedAt:now.toISOString(),
   dates,
   summary:{
    branches:rows.length,
    expectedClosings:rows.reduce(
     (n,r)=>n+r.expectedClosings,0
    ),
    acknowledgedClosings:rows.reduce(
     (n,r)=>n+r.acknowledgedClosings,0
    ),
    missingClosings:rows.reduce(
     (n,r)=>n+r.missingClosings,0
    ),
    openIncidents:rows.reduce(
     (n,r)=>n+r.openIncidents,0
    )
   },
   branches:rows
  };
 }
 // R10_3D_CLOSING_REVIEW
 async closingReviews(locationId:string,u:Principal){
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(locationId||'')){
   throw new BadRequestException('Valid locationId required');
  }

  if(!u.roles.some(r=>
   r==='SUPER_ADMIN'||r==='BRANCH_MANAGER'
  )){
   throw new ForbiddenException('Manager access required');
  }

  this.branchAccess(u,locationId);

  return this.db.branchClosingReview.findMany({
   where:{locationId},
   orderBy:{closingDate:'desc'},
   take:90
  });
 }

 // R10_3D4_HISTORICAL_CHECK
 // R10_3D5_DRIFT_QUEUE
 // R10_3D6_INCIDENTS
 async closingIncidents(locationId:string,u:Principal){
  this.branchAccess(u,locationId);

  return this.db.branchClosingDriftIncident.findMany({
   where:{locationId},
   orderBy:{lastDetectedAt:'desc'},
   take:100
  });
 }

 async captureClosingDrift(locationId:string,u:Principal){
  this.branchAccess(u,locationId);

  const scan=await this.closingDriftQueue(locationId,u);
  let created=0;
  let updated=0;

  for(const row of scan.rows){
   if(row.integrityStatus!=='CHANGES_DETECTED')continue;

   const existing=await this.db.branchClosingDriftIncident.findUnique({
    where:{reviewId:row.reviewId}
   });

   const data={
    changedSections:row.changedSections,
    currentIssues:row.currentIssues,
    lastDetectedAt:new Date()
   };

   if(existing){
    await this.db.branchClosingDriftIncident.update({
     where:{id:existing.id},
     data
    });
    updated++;
   }else{
    try{
     await this.db.branchClosingDriftIncident.create({
      data:{
       reviewId:row.reviewId,
       locationId,
       closingDate:new Date(row.date+'T00:00:00.000Z'),
       ...data
      }
     });
     created++;
    }catch(e){
     if(
      e instanceof Prisma.PrismaClientKnownRequestError&&
      e.code==='P2002'
     ){
      await this.db.branchClosingDriftIncident.update({
       where:{reviewId:row.reviewId},
       data
      });
      updated++;
     }else{
      throw e;
     }
    }
   }
  }

  return {
   scanned:scan.scanned,
   changed:scan.changed,
   failed:scan.failed,
   created,
   updated,
   incidents:await this.closingIncidents(locationId,u)
  };
 }

 async transitionClosingIncident(
  id:string,
  body:{status:string;note:string},
  u:Principal
 ){
  if(!u.roles.some(r=>
   r==='SUPER_ADMIN'||r==='BRANCH_MANAGER'
  )){
   throw new ForbiddenException('Manager role required');
  }

  const status=body?.status;
  const note=body?.note?.trim();

  if(
   !['INVESTIGATING','RESOLVED','REOPENED'].includes(status)||
   !note||note.length>2000
  ){
   throw new BadRequestException(
    'Valid status and note (1-2000 characters) required'
   );
  }

  const incident=await this.db.branchClosingDriftIncident.findUnique({
   where:{id}
  });

  if(!incident){
   throw new NotFoundException('Closing incident not found');
  }

  this.branchAccess(u,incident.locationId);

  if(
   (status==='INVESTIGATING'&&incident.status!=='OPEN'&&incident.status!=='REOPENED')||
   (status==='RESOLVED'&&incident.status!=='INVESTIGATING')||
   (status==='REOPENED'&&incident.status!=='RESOLVED')
  ){
   throw new ConflictException('Invalid incident transition');
  }

  const nextStatus=status==='REOPENED'?'OPEN':status;

  return this.db.$transaction(async tx=>{
   const changed=await tx.branchClosingDriftIncident.updateMany({
    where:{id,status:incident.status},
    data:{
     status:nextStatus,
     ownerId:status==='INVESTIGATING'?u.id:incident.ownerId,
     resolutionNote:note,
     resolvedAt:status==='RESOLVED'?new Date():null,
     resolvedById:status==='RESOLVED'?u.id:null
    }
   });

   if(changed.count!==1){
    throw new ConflictException('Incident changed concurrently');
   }

   const result=await tx.branchClosingDriftIncident.findUniqueOrThrow({
    where:{id}
   });

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'BRANCH_CLOSING_DRIFT_'+status,
     entityType:'BranchClosingDriftIncident',
     entityId:id,
     before:{status:incident.status},
     after:{
      status:nextStatus,
      note,
      actorId:u.id
     }
    }
   });

   return result;
  });
 }
 async closingDriftQueue(
  locationId:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(locationId||'')){
   throw new BadRequestException('Valid locationId required');
  }

  if(!u.roles.some(r=>
   r==='SUPER_ADMIN'||r==='BRANCH_MANAGER'
  )){
   throw new ForbiddenException('Manager role required');
  }

  this.branchAccess(u,locationId);

  const reviews=await this.db.branchClosingReview.findMany({
   where:{locationId},
   orderBy:{closingDate:'desc'},
   take:20,
   select:{
    id:true,
    closingDate:true,
    signedAt:true,
    signedById:true,
    status:true
   }
  });

  const rows=[];

  // Sequential execution avoids launching a large
  // number of reconciliation queries concurrently.
  for(const review of reviews){
   const date=review.closingDate.toISOString().slice(0,10);

   try{
    const integrity=await this.closingReviewIntegrity(
     locationId,date,u
    );

    rows.push({
     reviewId:review.id,
     date,
     signedAt:review.signedAt,
     signedById:review.signedById,
     acknowledgementStatus:review.status,
     integrityStatus:integrity.status,
     changed:integrity.changed,
     changedSections:integrity.changedSections,
     currentIssues:integrity.currentIssues,
     pendingPaymentCases:integrity.pendingPaymentCases,
     error:null as string|null
    });
   }catch(e){
    rows.push({
     reviewId:review.id,
     date,
     signedAt:review.signedAt,
     signedById:review.signedById,
     acknowledgementStatus:review.status,
     integrityStatus:'CHECK_FAILED',
     changed:false,
     changedSections:[] as string[],
     currentIssues:[] as string[],
     pendingPaymentCases:0,
     error:'Integrity check could not be completed'
    });
   }
  }

  return {
   locationId,
   generatedAt:new Date().toISOString(),
   scanned:rows.length,
   limit:20,
   truncated:reviews.length===20,
   changed:rows.filter(
    r=>r.integrityStatus==='CHANGES_DETECTED'
   ).length,
   unchanged:rows.filter(
    r=>r.integrityStatus==='NO_CHANGES_DETECTED'
   ).length,
   failed:rows.filter(
    r=>r.integrityStatus==='CHECK_FAILED'
   ).length,
   rows,
   note:
    'Read-only point-in-time drift scan. '+
    'Historical acknowledgements remain unchanged.'
  };
 }
 async closingReviewIntegrity(
  locationId:string,
  date:string,
  u:Principal
 ){
  const uuid=
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(!uuid.test(locationId||'')){
   throw new BadRequestException('Valid locationId required');
  }

  if(!u.roles.some(r=>
   r==='SUPER_ADMIN'||r==='BRANCH_MANAGER'
  )){
   throw new ForbiddenException('Manager role required');
  }

  this.branchAccess(u,locationId);

  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')){
   throw new BadRequestException('Date must use YYYY-MM-DD');
  }

  const closingDate=new Date(date+'T00:00:00.000Z');

  if(
   Number.isNaN(closingDate.getTime())||
   closingDate.toISOString().slice(0,10)!==date
  ){
   throw new BadRequestException('Invalid date');
  }

  const existing=await this.db.branchClosingReview.findUnique({
   where:{
    locationId_closingDate:{locationId,closingDate}
   }
  });

  if(!existing){
   throw new NotFoundException(
    'No closing acknowledgement exists for this branch date'
   );
  }

  const current=await this.branchReconciliation(
   locationId,date,date,u
  );

  const stored=existing.snapshot as Record<string,any>;

  // Compare only financial data and exception indicators.
  // Generation timestamps are intentionally excluded.
  const projection=(report:any)=>({
   status:report.status,
   issues:[...(report.issues||[])].sort(),
   sales:report.sales,
   shifts:report.shifts,
   drawer:report.drawer,
   refunds:report.refunds
  });

  const before=projection(stored);
  const after=projection(current);

  const changedSections:string[]=[];

  for(const key of [
   'status','issues','sales','shifts','drawer','refunds'
  ]){
   if(
    JSON.stringify((before as any)[key])!==
    JSON.stringify((after as any)[key])
   ){
    changedSections.push(key);
   }
  }

  const pendingPaymentCases=
   await this.db.paymentException.count({
    where:{
     locationId,
     status:{in:['OPEN','UNDER_REVIEW']}
    }
   });

  const storedPendingCases=
   Number(stored.pendingPaymentCases??0);

  if(pendingPaymentCases!==storedPendingCases){
   changedSections.push('paymentCases');
  }

  const currentIssues=[
   ...current.issues,
   ...(pendingPaymentCases>0
    ?['UNRESOLVED_PAYMENT_CASES']
    :[])
  ];

  const changed=changedSections.length>0;

  return {
   reviewId:existing.id,
   locationId,
   date,
   acknowledgedAt:existing.signedAt,
   checkedAt:new Date().toISOString(),
   changed,
   status:changed
    ?'CHANGES_DETECTED'
    :'NO_CHANGES_DETECTED',
   changedSections,
   currentIssues,
   pendingPaymentCases,
   storedPendingCases,
   originalStatus:stored.status||null,
   currentStatus:current.status,
   note:
    'Comparison reflects records visible at check time. '+
    'It is not a transactionally locked financial close.'
  };
 }
 async acknowledgeClosing(
  body:{locationId:string;date:string;note:string},
  u:Principal
 ){
  if(!u.roles.some(r=>
   r==='SUPER_ADMIN'||r==='BRANCH_MANAGER'
  )){
   throw new ForbiddenException('Manager access required');
  }

  const locationId=body?.locationId;
  const date=body?.date;
  const note=body?.note?.trim();

  if(!locationId||!date||!note||note.length>2000){
   throw new BadRequestException(
    'locationId, date and review note (max 2000 chars) required'
   );
  }

  this.branchAccess(u,locationId);

  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
   throw new BadRequestException('Date must use YYYY-MM-DD');
  }

  const closingDate=new Date(date+'T00:00:00.000Z');

  if(
   Number.isNaN(closingDate.getTime())||
   closingDate.toISOString().slice(0,10)!==date
  ){
   throw new BadRequestException('Invalid closing date');
  }

  const today=new Date().toISOString().slice(0,10);

  if(date>=today){
   throw new BadRequestException(
    'Only completed past UTC dates can be reviewed'
   );
  }

  // R10_3D3_CLOSING_INTEGRITY
  // Wait at least 24 hours after the selected UTC day ends.
  const closingDayEnd=new Date(
   closingDate.getTime()+86400000
  );

  const coolingOffEnds=new Date(
   closingDayEnd.getTime()+86400000
  );

  if(new Date()<coolingOffEnds){
   throw new ConflictException(
    'Closing review requires a 24-hour cooling-off period'
   );
  }

  const report=await this.branchReconciliation(
   locationId,date,date,u
  );

  const dayRange={
   gte:closingDate,
   lt:closingDayEnd
  };

  // Check every shift overlapping the selected day,
  // including shifts opened before that day.
  const shifts=await this.db.posShift.findMany({
   where:{
    locationId,
    openedAt:{lt:closingDayEnd},
    OR:[
     {closedAt:{gte:closingDate}},
     {closedAt:null}
    ]
   },
   select:{
    id:true,
    status:true,
    openedAt:true,
    closedAt:true
   }
  });

  if(shifts.some(s=>s.status!=='CLOSED'||!s.closedAt)){
   throw new ConflictException(
    'Closing review blocked: shift remains open'
   );
  }

  const shiftIds=shifts.map(s=>s.id);

  const snapshots=shiftIds.length
   ?await this.db.posShiftClosingSnapshot.findMany({
     where:{locationId,shiftId:{in:shiftIds}},
     select:{
      shiftId:true,
      closedAt:true,
      variance:true
     }
    })
   :[];

  const snapshotIds=new Set(snapshots.map(s=>s.shiftId));

  if(
   !shiftIds.length||
   shiftIds.some(id=>!snapshotIds.has(id))
  ){
   throw new ConflictException(
    'Closing review blocked: missing shift closing snapshot'
   );
  }

  if(snapshots.some(s=>!s.variance.isZero())){
   throw new ConflictException(
    'Closing review blocked: shift cash variance'
   );
  }

  const lateSales=await this.db.posSale.findMany({
   where:{
    locationId,
    shiftId:{in:shiftIds},
    status:'ACCEPTED'
   },
   select:{
    id:true,
    shiftId:true,
    syncedAt:true
   }
  });

  const closedAtByShift=new Map(
   snapshots.map(s=>[s.shiftId,s.closedAt])
  );

  if(lateSales.some(s=>{
   const closedAt=closedAtByShift.get(s.shiftId);
   return !closedAt||s.syncedAt>closedAt;
  })){
   throw new ConflictException(
    'Closing review blocked: late-synced sales require review'
   );
  }

  // Outstanding POS refund obligations may originate
  // from returns created before the selected date.
  const allReturns=await this.db.posReturn.findMany({
   where:{locationId,createdAt:{lt:closingDayEnd}},
   include:{lines:true,settlements:true}
  });

  const toCents=(v:Prisma.Decimal)=>
   v.mul(100)
    .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

  const unsettled=allReturns.some(ret=>{
   const due=ret.lines.reduce(
    (sum,line)=>sum+toCents(line.refundAmount),0
   );

   const settled=ret.settlements
    .filter(s=>s.settledAt<closingDayEnd)
    .reduce(
     (sum,s)=>sum+toCents(s.amount),0
    );

   return due!==settled;
  });

  if(unsettled){
   throw new ConflictException(
    'Closing review blocked: refund obligations require reconciliation'
   );
  }

  if(
   report.status!=='NO_DETECTED_EXCEPTIONS'||
   report.issues.length>0||
   report.shifts.closedInPeriod<1
  ){
   throw new ConflictException(
    'Closing review blocked: reconciliation incomplete or exceptions detected'
   );
  }

  const pendingCases=await this.db.paymentException.count({
   where:{
    locationId,
    status:{in:['OPEN','UNDER_REVIEW']}
   }
  });

  if(pendingCases>0){
   throw new ConflictException(
    'Closing review blocked: unresolved payment exception cases'
   );
  }

  const existing=await this.db.branchClosingReview.findUnique({
   where:{
    locationId_closingDate:{locationId,closingDate}
   }
  });

  if(existing){
   throw new ConflictException(
    'This branch date already has a review acknowledgement'
   );
  }

  try{
   return await this.db.$transaction(async tx=>{
    const created=await tx.branchClosingReview.create({
     data:{
      locationId,
      closingDate,
      status:'REVIEW_ACKNOWLEDGED',
      snapshot:JSON.parse(JSON.stringify({
       ...report,
       pendingPaymentCases:pendingCases,
       reviewedAt:new Date().toISOString()
      })) as Prisma.InputJsonValue,
      note,
      signedById:u.id
     }
    });

    await tx.auditLog.create({
     data:{
      actorId:u.id,
      action:'BRANCH_CLOSING_REVIEW_ACKNOWLEDGED',
      entityType:'BranchClosingReview',
      entityId:created.id,
      after:{
       locationId,
       date,
       status:created.status,
       signedById:u.id
      }
     }
    });

    return created;
   });
  }catch(e){
   if(
    e instanceof Prisma.PrismaClientKnownRequestError&&
    e.code==='P2002'
   ){
    throw new ConflictException(
     'Closing review already exists for this branch date'
    );
   }

   throw e;
  }
 }
}
@Controller('pos') @UseGuards(JwtAuthGuard,RolesGuard)
export class PosController {
 constructor(private pos:PosService){}

 // R10_3D7_HQ_OVERSIGHT_ROUTE
 @Get('finance/hq-closing-oversight')
 @Roles('SUPER_ADMIN')
 hqClosingOversightRoute(@CurrentUser() u:Principal){
  return this.pos.hqClosingOversight(u);
 }
 @Get('finance/closing-incidents')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 closingIncidentsRoute(
  @Query('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.closingIncidents(locationId,u);
 }

 @Post('finance/closing-incidents/scan')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 captureClosingDriftRoute(
  @Body() body:{locationId:string},
  @CurrentUser() u:Principal
 ){
  return this.pos.captureClosingDrift(body.locationId,u);
 }

 @Post('finance/closing-incidents/:id/transition')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 transitionClosingIncidentRoute(
  @Param('id') id:string,
  @Body() body:{status:string;note:string},
  @CurrentUser() u:Principal
 ){
  return this.pos.transitionClosingIncident(id,body,u);
 }
 @Get('finance/closing-reviews/drift-queue')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 closingDriftQueueRoute(
  @Query('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.closingDriftQueue(locationId,u);
 }
 @Get('finance/closing-reviews/integrity')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 closingReviewIntegrityRoute(
  @Query('locationId') locationId:string,
  @Query('date') date:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.closingReviewIntegrity(
   locationId,date,u
  );
 }
 @Get('finance/closing-reviews')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 closingReviewsRoute(
  @Query('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.closingReviews(locationId,u);
 }

 @Post('finance/closing-reviews/acknowledge')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 acknowledgeClosingRoute(
  @Body() body:{
   locationId:string;
   date:string;
   note:string;
  },
  @CurrentUser() u:Principal
 ){
  return this.pos.acknowledgeClosing(body,u);
 }

 @Get('finance/branch-reconciliation')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 branchReconciliationRoute(
  @Query('locationId') locationId:string,
  @Query('from') from:string,
  @Query('to') to:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.branchReconciliation(
   locationId,from,to,u
  );
 }

 @Get('finance/shift-variance-review')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 shiftVarianceReview(
  @Query('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.shiftVarianceReview(locationId,u);
 }

 @Get('finance/refund-settlement-review')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 refundSettlementReview(
  @Query('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.refundSettlementReview(locationId,u);
 }
 @Get('devices/:id/status') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') deviceStatus(@Param('id') id:string,@CurrentUser() u:Principal){return this.pos.deviceStatus(id,u);}
 @Post('devices') @Roles('SUPER_ADMIN','BRANCH_MANAGER') register(@Body() dto:RegisterDeviceDto,@CurrentUser() u:Principal){return this.pos.registerDevice(dto,u);}
 @Post('shifts/open') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') open(@Body() dto:OpenShiftDto,@CurrentUser() u:Principal){return this.pos.openShift(dto,u);}
 @Post('shifts/:id/close') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') close(@Param('id') id:string,@Body() dto:CloseShiftDto,@CurrentUser() u:Principal){return this.pos.closeShift(id,dto,u);}
 @Post('checkout/preflight') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') preflight(@Body() dto:PreflightDto,@CurrentUser() u:Principal){return this.pos.preflight(dto,u);}
 @Post('checkout/quote') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') quote(@Body() dto:QuoteCartDto,@CurrentUser() u:Principal){return this.pos.quoteCart(dto,u);}
 @Get('checkout/clearance-resolution-history/:locationId')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 clearanceResolutionHistoryRoute(
  @Param('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.clearanceResolutionHistory(locationId,u);
 }
 @Get('checkout/clearance-exceptions/:locationId')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 listClearanceExceptionsRoute(
  @Param('locationId') locationId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.listClearanceExceptions(locationId,u);
 }

 @Post('checkout/clearance-attempt/resolve-no-sale')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 resolveClearanceAttemptRoute(
  @Body() dto:ResolveClearanceAttemptDto,
  @CurrentUser() u:Principal
 ){
  return this.pos.resolveClearanceAttempt(dto,u);
 }
 @Post('checkout/clearance-attempt/register')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 registerClearanceAttemptRoute(
  @Body() dto:RegisterClearanceAttemptDto,
  @CurrentUser() u:Principal
 ){
  return this.pos.registerClearanceAttempt(dto,u);
 }

 @Get('checkout/clearance-attempt/:deviceId/:localSaleId')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 clearanceAttemptStatusRoute(
  @Param('deviceId') deviceId:string,
  @Param('localSaleId') localSaleId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.clearanceAttemptStatus(deviceId,localSaleId,u);
 }
 @Post('checkout/clearance-sale')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 clearanceSale(
  @Body() dto:ClearanceSaleDto,
  @CurrentUser() u:Principal
 ){
  return this.pos.clearanceSale(dto,u);
 }
 @Post('checkout/online-discounted-sale') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') discounted(@Body() dto:OnlineDiscountSaleDto,@CurrentUser() u:Principal){return this.pos.onlineDiscountSale(dto,u);}
 @Get('checkout/clearance-status/:deviceId/:localSaleId')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 clearanceStatus(
  @Param('deviceId') deviceId:string,
  @Param('localSaleId') localSaleId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.clearanceSaleStatus(
   deviceId,
   localSaleId,
   u
  );
 }
 @Get('checkout/discounted-status/:deviceId/:localSaleId') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 discountedStatus(@Param('deviceId') deviceId:string,@Param('localSaleId') localSaleId:string,@CurrentUser() u:Principal){
  return this.pos.discountedSaleStatus(deviceId,localSaleId,u);
 }
 @Get('sales/status/:deviceId/:localSaleId') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 offlineSaleStatusRoute(
  @Param('deviceId') deviceId:string,
  @Param('localSaleId') localSaleId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.offlineSaleStatus(deviceId,localSaleId,u);
 }
 @Post('sales/sync') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') sync(@Body() dto:SyncSaleDto,@CurrentUser() u:Principal){return this.pos.syncSale(dto,u);}
 @Post('returns/settlements')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 recordRefundSettlement(
  @Body() dto:RecordPosRefundSettlementDto,
  @CurrentUser() u:Principal
 ){
  return this.pos.recordRefundSettlement(dto,u);
 }
 @Get('returns/sale/:saleId')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 returnHistory(
  @Param('saleId') saleId:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.saleReturnHistory(saleId,u);
 }

 @Post('returns') @Roles('SUPER_ADMIN','BRANCH_MANAGER') returnSale(@Body() dto:ReturnDto,@CurrentUser() u:Principal){return this.pos.returnSale(dto,u);}
    @Get('finance/historical-summary')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 historicalRetailFinance(
  @Query('locationId') locationId:string,
  @Query('from') from:string,
  @Query('to') to:string,
  @CurrentUser() u:Principal
 ){
  return this.pos.historicalRetailFinance(
   locationId,from,to,u
  );
 }
@Get('finance/retail-summary')
  @Roles('SUPER_ADMIN','BRANCH_MANAGER')
  retailFinanceSummary(
   @Query('locationId') locationId:string,
   @CurrentUser() u:Principal
  ){
   return this.pos.retailFinanceSummary(locationId,u);
  }
@Get('shifts/:id/summary') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') summary(@Param('id') id:string,@CurrentUser() u:Principal){return this.pos.shiftSummary(id,u);}
 @Get('sales/:locationId') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER') list(@Param('locationId') id:string,@CurrentUser() u:Principal){return this.pos.listSales(id,u);}
}
