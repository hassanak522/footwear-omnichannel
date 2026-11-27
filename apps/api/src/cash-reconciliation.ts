import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsNumber, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CashReconciliationStatus, Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class SubmitCashDto {
 @IsUUID() shiftId!:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) countedCash!:number;
 @IsString() @MaxLength(1000) note!:string;
}
class ReviewCashDto {
 @IsEnum(CashReconciliationStatus) status!:CashReconciliationStatus;
 @IsString() @MaxLength(2000) note!:string;
}
@Controller('cash-reconciliation')
@UseGuards(JwtAuthGuard,RolesGuard)
export class CashReconciliationController {
 constructor(private readonly db:Db){}
 private isManager(u:Principal){return u.roles.includes('SUPER_ADMIN')||u.roles.includes('BRANCH_MANAGER');}
 private async getAccessible(id:string,u:Principal){
  const rec=await this.db.cashReconciliation.findUniqueOrThrow({where:{id}});
  assertLocation(u,rec.locationId);
  if(!this.isManager(u)&&rec.submittedById!==u.id)throw new ForbiddenException('Only your own reconciliation is accessible');
  return rec;
 }
  @Post('submit') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
  async submit(@Body() d:SubmitCashDto,@CurrentUser() u:Principal){
    const shift=await this.db.posShift.findUniqueOrThrow({where:{id:d.shiftId}});
    assertLocation(u,shift.locationId);
    if(shift.status!=='CLOSED')throw new ConflictException('Close the POS shift before reconciliation');
    if(!this.isManager(u)&&shift.cashierId!==u.id)throw new ForbiddenException('Only the shift cashier may submit');
    const snapshot=await this.db.posShiftClosingSnapshot.findUnique({where:{shiftId:d.shiftId}});
    if(!snapshot)throw new ConflictException('Closed legacy shift has no verified closing snapshot; manual review required');
    const countedCents=Math.round(d.countedCash*100);
    const snapshotCountedCents=Math.round(snapshot.countedCash.toNumber()*100);
    if(countedCents!==snapshotCountedCents)throw new ConflictException('Reconciliation counted cash must equal the shift closing snapshot; record a separate recount discrepancy');
    try{
      return await this.db.cashReconciliation.create({data:{
        shiftId:shift.id,locationId:shift.locationId,
        openingCash:snapshot.openingCash,recordedCashSales:snapshot.cashSales,
        expectedCash:snapshot.expectedCash,countedCash:snapshot.countedCash,variance:snapshot.variance,
        cashierNote:d.note.trim(),submittedById:u.id
      }});
    }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('Reconciliation already submitted for this shift');throw e;}
  }
 @Get() @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async list(@Query('locationId') locationId:string,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  return this.db.cashReconciliation.findMany({where:{locationId,...(!this.isManager(u)?{submittedById:u.id}:{})},orderBy:{submittedAt:'desc'},take:100});
 }

 // D24_FINAL_CASH_OPERATIONS

 private async cashOperationsContext(
   tx:Prisma.TransactionClient,
   shiftId:string,
   u:Principal
 ){
   await tx.$executeRaw`
     SELECT pg_advisory_xact_lock(
       hashtext(${`pos-shift-id:${shiftId}`})
     )
   `;

   const shift=await tx.posShift.findUniqueOrThrow({
     where:{id:shiftId}
   });

   assertLocation(u,shift.locationId);

   if(!this.isManager(u)&&shift.cashierId!==u.id){
     throw new ForbiddenException('Not your shift');
   }

   if(shift.status!=='CLOSED'){
     throw new ConflictException('Closed shift required');
   }

   const snapshot=await tx.posShiftClosingSnapshot.findUnique({
     where:{shiftId}
   });

   if(!snapshot||
      snapshot.locationId!==shift.locationId||
      snapshot.cashierId!==shift.cashierId||
      snapshot.deviceId!==shift.deviceId){
     throw new ConflictException(
       'Verified closing snapshot required'
     );
   }

   return {shift,snapshot};
 }

 @Get('operations/:shiftId')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async cashOperations(
   @Param('shiftId') shiftId:string,
   @CurrentUser() u:Principal
 ){
   return this.db.$transaction(async tx=>{
     const {shift,snapshot}=
       await this.cashOperationsContext(tx,shiftId,u);

     const denominationCount=
       await tx.posCashDenominationCount.findUnique({
         where:{shiftId}
       });

     const reconciliation=
       await tx.cashReconciliation.findUnique({
         where:{shiftId}
       });

     const handover=
       await tx.posCashHandover.findUnique({
         where:{shiftId}
       });

     return {
       shiftId,
       locationId:shift.locationId,
       currency:'PKR',
       snapshot,
       denominationCount,
       reconciliation,
       handover,
       denominationRecorded:!!denominationCount,
       reconciliationApproved:
         reconciliation?.status==='APPROVED',
       handoverAcknowledged:
         handover?.status==='ACKNOWLEDGED',
       cashOperationsComplete:
         !!denominationCount&&
         reconciliation?.status==='APPROVED'&&
         handover?.status==='ACKNOWLEDGED'
     };
   });
 }

 @Post('operations/:shiftId/denominations')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async recordDenominations(
   @Param('shiftId') shiftId:string,
   @Body() body:{denominations:Record<string,number>},
   @CurrentUser() u:Principal
 ){
   const allowed=[
     '1','2','5','10','20','50',
     '100','500','1000','5000'
   ];

   const input=body?.denominations;

   if(!input||typeof input!=='object'||Array.isArray(input)){
     throw new BadRequestException(
       'Denomination quantities required'
     );
   }

   const entries=Object.entries(input);

   if(entries.length>allowed.length||
      entries.some(([key,value])=>
        !allowed.includes(key)||
        !Number.isSafeInteger(value)||
        value<0||
        value>1000000
      )){
     throw new BadRequestException(
       'Invalid denomination quantities'
     );
   }

   const total=entries.reduce(
     (sum,[key,value])=>
       sum.plus(new Prisma.Decimal(key).mul(value)),
     new Prisma.Decimal(0)
   );

   return this.db.$transaction(async tx=>{
     const {shift,snapshot}=
       await this.cashOperationsContext(tx,shiftId,u);

     if(!total.eq(snapshot.countedCash)){
       throw new ConflictException(
         'Denomination total must equal closing counted cash'
       );
     }

     const existing=
       await tx.posCashDenominationCount.findUnique({
         where:{shiftId}
       });

     if(existing){
       const previous=existing.denominations as
         Record<string,number>;

       if(existing.recordedById===u.id&&
          allowed.every(key=>
            (previous[key]??0)===(input[key]??0)
          )){
         return existing;
       }

       throw new ConflictException(
         'Denomination count already recorded'
       );
     }

     const record=await tx.posCashDenominationCount.create({
       data:{
         shiftId,
         locationId:shift.locationId,
         denominations:input,
         total,
         recordedById:u.id
       }
     });

     await tx.auditLog.create({
       data:{
         actorId:u.id,
         action:'POS_CASH_DENOMINATIONS_RECORDED',
         entityType:'PosCashDenominationCount',
         entityId:record.id,
         after:{
           shiftId,
           locationId:shift.locationId,
           total:total.toString(),
           denominations:input
         }
       }
     });

     return record;
   });
 }

 @Post('operations/:shiftId/handover')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async submitHandover(
   @Param('shiftId') shiftId:string,
   @Body() body:{note:string},
   @CurrentUser() u:Principal
 ){
   const note=typeof body?.note==='string'
     ?body.note.trim():'';

   if(note.length<3||note.length>1000){
     throw new BadRequestException(
       'Handover note required, maximum 1000 characters'
     );
   }

   return this.db.$transaction(async tx=>{
     const {shift,snapshot}=
       await this.cashOperationsContext(tx,shiftId,u);

     const existing=await tx.posCashHandover.findUnique({
       where:{shiftId}
     });

     if(existing){
       if(existing.submittedById===u.id&&
          existing.submissionNote===note){
         return existing;
       }

       throw new ConflictException(
         'Handover already submitted'
       );
     }

     const count=
       await tx.posCashDenominationCount.findUnique({
         where:{shiftId}
       });

     if(!count||!count.total.eq(snapshot.countedCash)){
       throw new ConflictException(
         'Verified denomination count required'
       );
     }

     const reconciliation=
       await tx.cashReconciliation.findUnique({
         where:{shiftId}
       });

     if(!reconciliation||
        reconciliation.status!=='APPROVED'||
        !reconciliation.countedCash.eq(count.total)){
       throw new ConflictException(
         'Approved cash reconciliation required'
       );
     }

     const record=await tx.posCashHandover.create({
       data:{
         shiftId,
         locationId:shift.locationId,
         amount:count.total,
         submittedById:u.id,
         submissionNote:note
       }
     });

     await tx.auditLog.create({
       data:{
         actorId:u.id,
         action:'POS_CASH_HANDOVER_SUBMITTED',
         entityType:'PosCashHandover',
         entityId:record.id,
         after:{
           shiftId,
           locationId:shift.locationId,
           amount:record.amount.toString(),
           note
         }
       }
     });

     return record;
   });
 }

 @Post('operations/:shiftId/handover/acknowledge')
 @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 async acknowledgeHandover(
   @Param('shiftId') shiftId:string,
   @Body() body:{note:string},
   @CurrentUser() u:Principal
 ){
   const note=typeof body?.note==='string'
     ?body.note.trim():'';

   if(note.length<3||note.length>1000){
     throw new BadRequestException(
       'Acknowledgement note required'
     );
   }

   return this.db.$transaction(async tx=>{
     const {shift,snapshot}=
       await this.cashOperationsContext(tx,shiftId,u);

     const record=await tx.posCashHandover.findUniqueOrThrow({
       where:{shiftId}
     });

     if(record.submittedById===u.id||
        shift.cashierId===u.id){
       throw new ForbiddenException(
         'Independent cash recipient required'
       );
     }

     if(record.status==='ACKNOWLEDGED'&&
        record.acknowledgedById===u.id&&
        record.acknowledgementNote===note){
       return record;
     }

     if(record.status!=='SUBMITTED'||
        record.locationId!==shift.locationId||
        !record.amount.eq(snapshot.countedCash)){
       throw new ConflictException(
         'Invalid cash handover state'
       );
     }

     const changed=await tx.posCashHandover.updateMany({
       where:{
         id:record.id,
         status:'SUBMITTED'
       },
       data:{
         status:'ACKNOWLEDGED',
         acknowledgedById:u.id,
         acknowledgedAt:new Date(),
         acknowledgementNote:note
       }
     });

     if(changed.count!==1){
       throw new ConflictException(
         'Handover changed; reload'
       );
     }

     await tx.auditLog.create({
       data:{
         actorId:u.id,
         action:'POS_CASH_HANDOVER_ACKNOWLEDGED',
         entityType:'PosCashHandover',
         entityId:record.id,
         after:{
           shiftId,
           locationId:shift.locationId,
           amount:record.amount.toString(),
           note
         }
       }
     });

     return tx.posCashHandover.findUniqueOrThrow({
       where:{id:record.id}
     });
   });
 }

 @Get(':id') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async detail(@Param('id') id:string,@CurrentUser() u:Principal){return this.getAccessible(id,u);}
 @Patch(':id/review') @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 async review(@Param('id') id:string,@Body() d:ReviewCashDto,@CurrentUser() u:Principal){
  if(!this.isManager(u))throw new ForbiddenException('Manager required');
  const rec=await this.getAccessible(id,u);
  if(rec.status!=='SUBMITTED')throw new ConflictException('Already reviewed');
  if(d.status!=='APPROVED'&&d.status!=='DISPUTED')throw new BadRequestException('Review must APPROVE or DISPUTE');
  if(!d.note.trim())throw new BadRequestException('Review note required');
  // R10_3D24A_INDEPENDENT_REVIEW
  if(rec.submittedById===u.id){
   throw new ForbiddenException(
    'Reconciliation submitter cannot review their own submission'
   );
  }

  return this.db.$transaction(async tx=>{

   const result=await tx.cashReconciliation.updateMany({
    where:{
     id,
     status:'SUBMITTED'
    },
    data:{
     status:d.status,
     reviewedById:u.id,
     reviewedAt:new Date(),
     reviewNote:d.note.trim()
    }
   });

   if(result.count!==1){
    throw new ConflictException(
     'Reconciliation changed; reload'
    );
   }

   const reviewed=await tx.cashReconciliation.findUniqueOrThrow({
    where:{id}
   });

   await tx.auditLog.create({
    data:{
     actorId:u.id,
     action:'CASH_RECONCILIATION_REVIEWED',
     entityType:'CashReconciliation',
     entityId:id,
     before:{
      status:rec.status
     },
     after:{
      status:reviewed.status,
      shiftId:reviewed.shiftId,
      locationId:reviewed.locationId,
      submittedById:reviewed.submittedById,
      reviewedById:u.id,
      variance:reviewed.variance.toString(),
      reviewNote:d.note.trim()
     }
    }
   });

   return reviewed;

  });
 }
}
