import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, ArrayMaxSize, ArrayMinSize, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DrawerMovementStatus, DrawerMovementType, Prisma, SettlementMatchStatus } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class MovementDto {
 @IsUUID() shiftId!:string;
 @IsEnum(DrawerMovementType) type!:DrawerMovementType;
 @IsNumber({maxDecimalPlaces:2}) @Min(0.01) amount!:number;
 @IsString() @MaxLength(1000) reason!:string;
 @IsOptional() @IsString() @MaxLength(200) externalReference?:string;
}
class ReviewMovementDto {
 @IsEnum(DrawerMovementStatus) status!:DrawerMovementStatus;
 @IsString() @MaxLength(2000) note!:string;
}
function manager(u:Principal){if(!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER'))throw new ForbiddenException('Manager required');}
function money(n:number){return new Prisma.Decimal(n.toFixed(2));}
@Controller('drawer-movements') @UseGuards(JwtAuthGuard,RolesGuard)
export class DrawerMovementController {
 constructor(private readonly db:Db){}
 @Post() @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async create(@Body() d:MovementDto,@CurrentUser() u:Principal){
  if(!d.reason.trim())throw new BadRequestException('Reason required');
  const shift=await this.db.posShift.findUniqueOrThrow({where:{id:d.shiftId}});
  assertLocation(u,shift.locationId);
  if(shift.status!=='OPEN')throw new ConflictException('Movements require an open shift');
  if(!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER')&&shift.cashierId!==u.id)throw new ForbiddenException('Not your shift');
  return this.db.drawerMovement.create({data:{locationId:shift.locationId,shiftId:shift.id,type:d.type,amount:money(d.amount),reason:d.reason.trim(),externalReference:d.externalReference?.trim()||null,createdById:u.id}});
 }
 @Get() @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async list(@Query('locationId') locationId:string,@Query('shiftId') shiftId:string|undefined,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');assertLocation(u,locationId);
  return this.db.drawerMovement.findMany({where:{locationId,...(shiftId?{shiftId}:{}),...(!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER')?{createdById:u.id}:{})},orderBy:{createdAt:'desc'},take:200});
 }
 @Patch(':id/review') @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 
async review(
  @Param('id') id:string,
  @Body() d:ReviewMovementDto,
  @CurrentUser() u:Principal
){
  manager(u);

  if(!['APPROVED','REJECTED'].includes(d.status)){
    throw new BadRequestException('Review APPROVED or REJECTED');
  }

  if(!d.note.trim()){
    throw new BadRequestException('Review note required');
  }

  return this.db.$transaction(async tx=>{
    const initial=await tx.drawerMovement.findUniqueOrThrow({
      where:{id}
    });

    assertLocation(u,initial.locationId);

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`pos-shift-id:${initial.shiftId}`})
      )
    `;

    const movement=await tx.drawerMovement.findUniqueOrThrow({
      where:{id}
    });

    assertLocation(u,movement.locationId);

    const shift=await tx.posShift.findUniqueOrThrow({
      where:{id:movement.shiftId}
    });

    if(shift.locationId!==movement.locationId){
      throw new ConflictException('Movement location mismatch');
    }

    if(shift.status!=='OPEN'){
      throw new ConflictException(
        'Shift closed; use post-closure adjustment workflow'
      );
    }

    const updated=await tx.drawerMovement.updateMany({
      where:{id,status:'PENDING'},
      data:{
        status:d.status,
        reviewedById:u.id,
        reviewNote:d.note.trim(),
        reviewedAt:new Date()
      }
    });

    if(updated.count!==1){
      throw new ConflictException('Already reviewed');
    }

    await tx.auditLog.create({
      data:{
        actorId:u.id,
        action:'DRAWER_MOVEMENT_REVIEWED',
        entityType:'DrawerMovement',
        entityId:id,
        after:{
          shiftId:movement.shiftId,
          status:d.status,
          amount:movement.amount.toString(),
          type:movement.type
        }
      }
    });

    return tx.drawerMovement.findUniqueOrThrow({
      where:{id}
    });
  });
}

  @Get('shift/:shiftId/summary') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
  async summary(@Param('shiftId') shiftId:string,@CurrentUser() u:Principal){
    const shift=await this.db.posShift.findUniqueOrThrow({where:{id:shiftId}});
    assertLocation(u,shift.locationId);
    if(!u.roles.includes('SUPER_ADMIN')&&!u.roles.includes('BRANCH_MANAGER')&&shift.cashierId!==u.id)throw new ForbiddenException('Not your shift');
    const reconciliation=await this.db.cashReconciliation.findUnique({where:{shiftId}});
    if(shift.status==='CLOSED'){
      const snapshot=await this.db.posShiftClosingSnapshot.findUnique({where:{shiftId}});
      if(!snapshot)throw new ConflictException('Closed legacy shift has no verified closing snapshot; manual review required');
      return {shiftId,snapshotVerified:true,approvedMovementAdjustment:snapshot.drawerAdjustment.toString(),
        movementCount:snapshot.approvedMovements,originalExpectedCash:snapshot.expectedCash.toString(),
        adjustedExpectedCash:snapshot.expectedCash.toString(),originalCountedCash:snapshot.countedCash.toString(),
        reconciliationStatus:reconciliation?.status??null,
        note:'Drawer adjustment is already included in snapshot expected cash; not added twice.'};
    }
    const movements=await this.db.drawerMovement.findMany({where:{shiftId,status:'APPROVED'}});
    const adjustment=movements.reduce((n,m)=>n+(m.type==='CASH_IN'?1:-1)*Math.round(m.amount.toNumber()*100),0);
    return {shiftId,snapshotVerified:false,approvedMovementAdjustment:(adjustment/100).toFixed(2),
      movementCount:movements.length,note:'Open shift: provisional drawer adjustment; no immutable closing balance yet.'};
  }
}
class EntryDto {
 @IsString() @MaxLength(200) externalId!:string;
 @IsString() @MaxLength(200) terminalReference!:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) grossAmount!:number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) feeAmount!:number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) netAmount!:number;
}
class ImportBatchDto {
 @IsUUID() locationId!:string;
 @IsString() @MaxLength(100) provider!:string;
 @IsString() @MaxLength(200) statementReference!:string;
 @IsDateString() statementDate!:string;
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(()=>EntryDto) entries!:EntryDto[];
}
class ReviewEntryDto {
 @IsEnum(SettlementMatchStatus) status!:SettlementMatchStatus;
 @IsOptional() @IsUUID() matchedTenderId?:string;
 @IsString() @MaxLength(1000) note!:string;
}
@Controller('settlements') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class SettlementController {
 constructor(private readonly db:Db){}
 @Post('import')
 async importBatch(@Body() d:ImportBatchDto,@CurrentUser() u:Principal){
  manager(u);assertLocation(u,d.locationId);
  if(!d.provider.trim()||!d.statementReference.trim())throw new BadRequestException('Provider and statement reference required');
  const ids=d.entries.map(e=>e.externalId.trim());if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw new BadRequestException('Unique nonempty external IDs required');
  for(const e of d.entries){if(!e.terminalReference.trim())throw new BadRequestException('Terminal reference required');if(Math.round(e.grossAmount*100)-Math.round(e.feeAmount*100)!==Math.round(e.netAmount*100))throw new BadRequestException('Net amount must equal gross minus fee');}
  try{return await this.db.settlementBatch.create({data:{locationId:d.locationId,provider:d.provider.trim(),statementReference:d.statementReference.trim(),statementDate:new Date(d.statementDate),createdById:u.id,
   entries:{create:d.entries.map(e=>({externalId:e.externalId.trim(),terminalReference:e.terminalReference.trim(),grossAmount:money(e.grossAmount),feeAmount:money(e.feeAmount),netAmount:money(e.netAmount)}))}},include:{entries:true}});
  }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('Duplicate statement or external transaction');throw e;}
 }
 @Get()
 async list(@Query('locationId') locationId:string,@CurrentUser() u:Principal){manager(u);if(!locationId)throw new BadRequestException('locationId required');assertLocation(u,locationId);return this.db.settlementBatch.findMany({where:{locationId},orderBy:{createdAt:'desc'},take:100,include:{_count:{select:{entries:true}}}});}
 @Get(':id')
 async detail(@Param('id') id:string,@CurrentUser() u:Principal){manager(u);const batch=await this.db.settlementBatch.findUniqueOrThrow({where:{id},include:{entries:true}});assertLocation(u,batch.locationId);return batch;}
 @Get(':id/match-preview')
 async preview(@Param('id') id:string,@CurrentUser() u:Principal){
  manager(u);const batch=await this.db.settlementBatch.findUniqueOrThrow({where:{id},include:{entries:true}});assertLocation(u,batch.locationId);
  const refs=[...new Set(batch.entries.map(e=>e.terminalReference))];
  const tenders=await this.db.posSaleTender.findMany({where:{type:'CARD',reference:{in:refs},sale:{locationId:batch.locationId,status:'ACCEPTED'}},select:{id:true,reference:true,amount:true,saleId:true}});
  return batch.entries.map(e=>{const matches=tenders.filter(t=>t.reference===e.terminalReference&&t.amount.equals(e.grossAmount));return {entryId:e.id,externalId:e.externalId,reference:e.terminalReference,gross:e.grossAmount.toString(),status:e.status,candidateCount:matches.length,candidates:matches.map(m=>({tenderId:m.id,saleId:m.saleId})),suggestedStatus:matches.length===1?'MATCHED':matches.length>1?'AMBIGUOUS':'UNMATCHED'};});
 }
 @Patch('entries/:entryId/review')
 async review(@Param('entryId') entryId:string,@Body() d:ReviewEntryDto,@CurrentUser() u:Principal){
  manager(u);if(!d.note.trim())throw new BadRequestException('Review note required');
  const entry=await this.db.settlementEntry.findUniqueOrThrow({where:{id:entryId},include:{batch:true}});assertLocation(u,entry.batch.locationId);
  if(entry.status==='MATCHED')throw new ConflictException('Matched entry is locked');
  if(d.status==='MATCHED'){
   if(!d.matchedTenderId)throw new BadRequestException('Matched tender ID required');
   const tender=await this.db.posSaleTender.findUnique({where:{id:d.matchedTenderId},include:{sale:true}});
   if(!tender||tender.type!=='CARD'||tender.sale.locationId!==entry.batch.locationId||tender.sale.status!=='ACCEPTED'||tender.reference!==entry.terminalReference||!tender.amount.equals(entry.grossAmount))throw new ConflictException('Tender reference, amount, location or sale status mismatch');
   const already=await this.db.settlementEntry.findFirst({where:{matchedTenderId:tender.id,status:'MATCHED',NOT:{id:entryId}}});if(already)throw new ConflictException('Tender already matched');
  }else if(d.matchedTenderId)throw new BadRequestException('Tender ID only for MATCHED');
  const result=await this.db.settlementEntry.updateMany({where:{id:entryId,status:entry.status},data:{status:d.status,matchedTenderId:d.status==='MATCHED'?d.matchedTenderId:null,reviewNote:d.note.trim(),reviewedById:u.id}});
  if(result.count!==1)throw new ConflictException('Entry changed; reload');return this.db.settlementEntry.findUniqueOrThrow({where:{id:entryId}});
 }
}
