import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards
} from '@nestjs/common';

import {
  IsUUID,
  IsString,
  IsIn,
  MinLength,
  MaxLength
} from 'class-validator';

import { Prisma } from '@prisma/client';

import { Db } from './db';

import {
  assertLocation,
  CurrentUser,
  JwtAuthGuard,
  Principal,
  Roles,
  RolesGuard
} from './auth';

// R10_3D24_48D_CORRECTION_AUTHORIZATION_API

class RegisterCorrectionDto {

  @IsUUID()
  id!:string;

  @IsUUID()
  investigationId!:string;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  evidenceReference!:string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!:string;
}

class ReviewCorrectionDto {

  @IsIn(['APPROVED','REJECTED'])
  decision!:'APPROVED'|'REJECTED';

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!:string;
}

class RecordCorrectionExecutionDto {

  @IsUUID()
  id!:string;

  @IsIn([
    'VERIFIED_HISTORICAL_PAYMENT',
    'VERIFIED_CORRECTIVE_REVERSAL'
  ])
  executionType!:
    'VERIFIED_HISTORICAL_PAYMENT'|
    'VERIFIED_CORRECTIVE_REVERSAL';

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  evidenceReference!:string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  evidenceNote!:string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  debitAccountCode!:string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  creditAccountCode!:string;
}

class PostCorrectionAccountingDto {

  @IsUUID()
  id!:string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!:string;

}

class AuthorizeCorrectionClosureDto {

  @IsUUID()
  id!:string;

  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  note!:string;

}

class ReleaseCorrectionDto {

  @IsUUID()
  id!:string;

  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  note!:string;

}

class RecordEconomicEventDto {

  @IsUUID()
  id!:string;

  @IsString()
  @MinLength(24)
  @MaxLength(24)
  economicEventAt!:string;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  evidenceReference!:string;

  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  evidenceNote!:string;

}

type Tx = Prisma.TransactionClient;

type Investigation =
  Prisma.PosPaymentReconciliationGetPayload<{}>;

type Correction =
  Prisma.PosFinancialCorrectionGetPayload<{}>;

@Controller('pos-financial-corrections')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class PosFinancialCorrectionController {

  constructor(private readonly db:Db){}

  private uuid(value:string){

    if(
      typeof value!=='string'||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ){
      throw new BadRequestException('Valid UUID required');
    }

    return value.toLowerCase();
  }

  private clean(
    value:string,
    min:number,
    max:number
  ){

    if(typeof value!=='string'){
      throw new BadRequestException('Text required');
    }

    const result=value.trim();

    if(result.length<min||result.length>max){
      throw new BadRequestException('Invalid text length');
    }

    return result;
  }

  private normalize(value:string){
    return value.trim().toLowerCase();
  }

  private async transaction<T>(
    work:(tx:Tx)=>Promise<T>
  ):Promise<T>{

    for(let attempt=0;attempt<5;attempt++){

      try{

        return await this.db.$transaction(work,{
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
          maxWait:5000,
          timeout:20000
        });

      }catch(error){

        if(
          error instanceof
            Prisma.PrismaClientKnownRequestError
        ){

          if(error.code==='P2034'){

            if(attempt===4){
              throw new ConflictException(
                'Concurrent financial activity; retry'
              );
            }

            await new Promise<void>(resolve=>
              setTimeout(resolve,50*(attempt+1))
            );

            continue;
          }

          if(error.code==='P2002'){
            throw new ConflictException(
              'An active financial correction already exists'
            );
          }
        }

        throw error;
      }
    }

    throw new ConflictException(
      'Financial transaction retry exhausted'
    );
  }

  private correctionType(i:Investigation){

    if(
      i.status!=='APPROVED'||
      i.executionAbandoned!==true||
      !i.reviewedAt||
      !i.reviewedById||
      !i.amount.isFinite()||
      !i.amount.isPositive()
    ){
      throw new ConflictException(
        'Approved abandoned investigation required'
      );
    }

    if(
      i.kind==='REFUND_PAYOUT'&&
      i.proposedOutcome==='NOT_PAID'&&
      i.refundAttemptId&&
      !i.exchangeAttemptId
    ){
      return 'CONTRADICTORY_REFUND_PAYMENT';
    }

    if(
      i.kind==='EXCHANGE_COLLECTION'&&
      i.proposedOutcome==='NOT_COLLECTED'&&
      i.exchangeAttemptId&&
      !i.refundAttemptId
    ){
      return 'CONTRADICTORY_EXCHANGE_COLLECTION';
    }

    if(
      i.kind==='EXCHANGE_REVERSAL'&&
      i.proposedOutcome==='NOT_REVERSED'&&
      i.exchangeAttemptId&&
      !i.refundAttemptId
    ){
      return 'UNRESOLVED_EXCHANGE_REVERSAL';
    }

    throw new ConflictException(
      'Investigation is not eligible for correction'
    );
  }

  private async lockInvestigation(
    tx:Tx,
    investigationId:string,
    u:Principal
  ){

    const initial=
      await tx.posPaymentReconciliation.findUnique({
        where:{id:investigationId}
      });

    if(!initial){
      throw new NotFoundException(
        'Investigation not found'
      );
    }

    assertLocation(u,initial.locationId);

    // Use the original shift lock before financial locks.

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${`pos-shift-id:${initial.shiftId}`})
      )
    `;

    if(initial.refundAttemptId){

      const refund=
        await tx.posRefundAttempt.findUnique({
          where:{id:initial.refundAttemptId}
        });

      if(!refund){
        throw new ConflictException(
          'Original refund attempt missing'
        );
      }

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`pos-refund-settlement:${refund.returnId}`})
        )
      `;

    }else if(initial.exchangeAttemptId){

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`pos-exchange:${initial.exchangeAttemptId}`})
        )
      `;

    }else{

      throw new ConflictException(
        'Original financial attempt missing'
      );
    }

    await tx.$queryRaw`
      SELECT id
      FROM "PosPaymentReconciliation"
      WHERE id=${investigationId}::uuid
      FOR UPDATE
    `;

    const i=
      await tx.posPaymentReconciliation.findUniqueOrThrow({
        where:{id:investigationId}
      });

    assertLocation(u,i.locationId);

    this.correctionType(i);

    return i;
  }

  private async verifyOriginal(
    tx:Tx,
    i:Investigation
  ){

    const type=this.correctionType(i);

    const shift=await tx.posShift.findUnique({
      where:{id:i.shiftId}
    });

    if(
      !shift||
      shift.locationId!==i.locationId||
      shift.deviceId!==i.deviceId
    ){
      throw new ConflictException(
        'Original shift identity mismatch'
      );
    }

    if(i.refundAttemptId){

      const refund=
        await tx.posRefundAttempt.findUnique({
          where:{id:i.refundAttemptId}
        });

      if(
        !refund||
        refund.locationId!==i.locationId||
        refund.deviceId!==i.deviceId||
        refund.shiftId!==i.shiftId||
        refund.payloadHash!==i.payloadHash||
        !refund.amount.eq(i.amount)||
        refund.status!=='RESOLVED_NO_PAYMENT'||
        refund.paymentState!=='NOT_PAID'||
        refund.settlementId!==null
      ){
        throw new ConflictException(
          'Original refund is not eligible for correction'
        );
      }

    }else if(i.exchangeAttemptId){

      const exchange=
        await tx.posExchangeAttempt.findUnique({
          where:{id:i.exchangeAttemptId}
        });

      if(
        !exchange||
        exchange.locationId!==i.locationId||
        exchange.deviceId!==i.deviceId||
        exchange.shiftId!==i.shiftId||
        exchange.payloadHash!==i.payloadHash
      ){
        throw new ConflictException(
          'Original exchange identity mismatch'
        );
      }

      if(type==='CONTRADICTORY_EXCHANGE_COLLECTION'){

        if(
          exchange.status!=='RESOLVED_NO_EXCHANGE'||
          exchange.paymentState!=='NOT_COLLECTED'||
          exchange.reversalStatus!=='NONE'
        ){
          throw new ConflictException(
            'Original collection is no longer eligible'
          );
        }

      }else{

        if(
          !['REGISTERED','UNKNOWN'].includes(exchange.status)||
          exchange.paymentState!=='CONFIRMED'||
          exchange.reversalStatus!=='AUTHORIZED'
        ){
          throw new ConflictException(
            'Original reversal is no longer on hold'
          );
        }
      }

      const competing=
        await tx.posPaymentReconciliation.findFirst({
          where:{
            exchangeAttemptId:i.exchangeAttemptId,
            id:{not:i.id},
            OR:[
              {status:'PENDING'},
              {
                status:'APPROVED',
                kind:i.kind,
                proposedOutcome:{
                  in:['COLLECTED','REVERSED']
                }
              }
            ]
          },
          select:{id:true}
        });

      if(competing){
        throw new ConflictException(
          'Competing payment investigation exists'
        );
      }
    }

    return type;
  }

  // R10_3D24_48D3E_EXECUTION_AUTHORIZATION

  private canRecordExecution(
    correction:Correction,
    investigation:Investigation,
    u:Principal
  ){

    return (
      u.roles.includes('SUPER_ADMIN')&&
      correction.status==='APPROVED'&&
      !!correction.reviewedAt&&
      !!correction.reviewedById&&
      correction.submittedById!==u.id&&
      correction.reviewedById!==u.id&&
      investigation.paymentOperatorId!==u.id&&
      investigation.submittedById!==u.id&&
      investigation.reviewedById!==u.id
    );
  }

  private executionInput(
    dto:RecordCorrectionExecutionDto,
    correction:Correction,
    investigation:Investigation
  ){

    const id=this.uuid(dto.id);

    const evidenceReference=
      this.clean(dto.evidenceReference,5,200);

    const evidenceNote=
      this.clean(dto.evidenceNote,10,1000);

    const debitAccountCode=
      this.clean(dto.debitAccountCode,2,32);

    const creditAccountCode=
      this.clean(dto.creditAccountCode,2,32);

    const expectedType=
      correction.correctionType===
        'UNRESOLVED_EXCHANGE_REVERSAL'
        ?'VERIFIED_CORRECTIVE_REVERSAL'
        :'VERIFIED_HISTORICAL_PAYMENT';

    if(dto.executionType!==expectedType){
      throw new BadRequestException(
        'Correction execution type mismatch'
      );
    }

    if(
      this.normalize(evidenceReference)===
      this.normalize(investigation.evidenceReference)
    ){
      throw new BadRequestException(
        'Contradictory investigation evidence cannot be reused'
      );
    }

    if(
      !/^[A-Za-z0-9_-]{2,32}$/.test(debitAccountCode)||
      !/^[A-Za-z0-9_-]{2,32}$/.test(creditAccountCode)||
      this.normalize(debitAccountCode)===
      this.normalize(creditAccountCode)
    ){
      throw new BadRequestException(
        'Distinct valid accounting codes required'
      );
    }

    return {
      id,
      executionType:expectedType,
      evidenceReference,
      evidenceNote,
      debitAccountCode,
      creditAccountCode
    };
  }

  private response(
    correction:Correction,
    investigation:Investigation,
    u:Principal
  ){

    const canReview=
      correction.status==='PENDING'&&
      u.roles.includes('SUPER_ADMIN')&&
      correction.submittedById!==u.id&&
      investigation.paymentOperatorId!==u.id&&
      investigation.submittedById!==u.id&&
      investigation.reviewedById!==u.id;

    return {
      ...correction,
      amount:correction.amount.toFixed(2),
      currency:'PKR',
      canReview,
      paymentExecutionAuthorized:false,
      accountingPosted:false,
      financialHoldReleased:false
    };
  }

  // R10_3D24_48D3E2_ATOMIC_EXECUTION

  private approvedAccounts(
    correction:Correction,
    debitAccountCode:string,
    creditAccountCode:string
  ){

    const raw=
      process.env.POS_FINANCIAL_CORRECTION_ACCOUNT_MAP;

    if(!raw){
      throw new ConflictException(
        'Finance-approved correction account mapping is not configured'
      );
    }

    let mapping:Record<string,{
      debitAccountCode:string;
      creditAccountCode:string;
    }>;

    try{
      mapping=JSON.parse(raw);
    }catch{
      throw new ConflictException(
        'Correction account mapping configuration is invalid'
      );
    }

    const approved=mapping?.[correction.correctionType];

    if(
      !approved||
      typeof approved.debitAccountCode!=='string'||
      typeof approved.creditAccountCode!=='string'||
      approved.debitAccountCode!==debitAccountCode||
      approved.creditAccountCode!==creditAccountCode
    ){
      throw new ConflictException(
        'Accounts do not match finance-approved correction mapping'
      );
    }
  }

  private async verifyExecutionBatch(
    tx:Tx,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>,
    correction:Correction
  ){

    // R10_3D24_48D3F_AUTHORITATIVE_EXECUTION

    const investigation=
      await tx.posPaymentReconciliation.findUniqueOrThrow({
        where:{id:correction.investigationId}
      });

    const expectedType=
      correction.correctionType===
        'UNRESOLVED_EXCHANGE_REVERSAL'
        ?'VERIFIED_CORRECTIVE_REVERSAL'
        :'VERIFIED_HISTORICAL_PAYMENT';

    if(
      correction.status!=='APPROVED'||
      !correction.reviewedAt||
      !correction.reviewedById||
      investigation.status!=='APPROVED'||
      investigation.executionAbandoned!==true||
      investigation.locationId!==correction.locationId||
      investigation.shiftId!==correction.originalShiftId||
      investigation.deviceId!==correction.originalDeviceId||
      investigation.payloadHash!==correction.payloadHash||
      investigation.refundAttemptId!==correction.refundAttemptId||
      investigation.exchangeAttemptId!==correction.exchangeAttemptId||
      !investigation.amount.eq(correction.amount)||
      this.correctionType(investigation)!==correction.correctionType||
      execution.executionType!==expectedType||
      execution.recordedAt<correction.reviewedAt||
      execution.recordedById===correction.submittedById||
      execution.recordedById===correction.reviewedById||
      execution.recordedById===investigation.paymentOperatorId||
      execution.recordedById===investigation.submittedById||
      execution.recordedById===investigation.reviewedById||
      this.normalize(execution.evidenceReference)===
        this.normalize(investigation.evidenceReference)||
      execution.evidenceReference.trim().length<5||
      execution.evidenceNote.trim().length<10||
      !/^[A-Za-z0-9_-]{2,32}$/.test(execution.debitAccountCode)||
      !/^[A-Za-z0-9_-]{2,32}$/.test(execution.creditAccountCode)||
      this.normalize(execution.debitAccountCode)===
        this.normalize(execution.creditAccountCode)
    ){
      throw new ConflictException(
        'Correction execution authorization integrity failure'
      );
    }

    const batch=await tx.financePostingBatch.findUnique({
      where:{id:execution.postingBatchId},
      include:{lines:true}
    });

    if(
      !batch||
      execution.correctionId!==correction.id||
      execution.locationId!==correction.locationId||
      !execution.amount.eq(correction.amount)||
      batch.locationId!==correction.locationId||
      batch.sourceType!=='POS_FINANCIAL_CORRECTION'||
      batch.sourceId!==correction.id||
      batch.createdById!==execution.recordedById||
      batch.createdAt.getTime()!==execution.recordedAt.getTime()||
      batch.idempotencyKey!==`POS_CORRECTION:${correction.id}`||
      batch.status!=='STAGED'||
      batch.lines.length!==2
    ){
      throw new ConflictException(
        'Correction posting batch integrity failure'
      );
    }

    const debit=batch.lines.filter(line=>
      line.accountCode===execution.debitAccountCode&&
      line.debit.eq(correction.amount)&&
      line.credit.eq(0)
    );

    const credit=batch.lines.filter(line=>
      line.accountCode===execution.creditAccountCode&&
      line.credit.eq(correction.amount)&&
      line.debit.eq(0)
    );

    if(debit.length!==1||credit.length!==1){
      throw new ConflictException(
        'Correction accounting balance integrity failure'
      );
    }

    return batch;
  }

  private executionResponse(
    correction:Correction,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>,
    duplicate:boolean
  ){

    return {
      correctionId:correction.id,
      correctionStatus:correction.status,
      correctionType:correction.correctionType,
      executionId:execution.id,
      locationId:execution.locationId,
      amount:execution.amount.toFixed(2),
      currency:'PKR',
      executionType:execution.executionType,
      evidenceReference:execution.evidenceReference,
      evidenceNote:execution.evidenceNote,
      debitAccountCode:execution.debitAccountCode,
      creditAccountCode:execution.creditAccountCode,
      postingBatchId:execution.postingBatchId,
      recordedById:execution.recordedById,
      recordedAt:execution.recordedAt,
      executionRecorded:true,
      accountingStaged:true,
      accountingPosted:false,
      paymentExecutionAuthorized:false,
      financialHoldReleased:false,
      duplicate
    };
  }

  @Post(':id/execution')
  @Roles('SUPER_ADMIN')
  async recordExecution(
    @Param('id') id:string,
    @Body() dto:RecordCorrectionExecutionDto,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    if(!u.roles.includes('SUPER_ADMIN')){
      throw new ForbiddenException(
        'Independent HQ execution recorder required'
      );
    }

    return this.transaction(async tx=>{

      // Prevent concurrent period-lock insertion during staging.
      // Acquire before financial reads establish the transaction snapshot.

      await tx.$executeRaw`
        LOCK TABLE "FinancePeriodLock" IN SHARE MODE
      `;

      const initial=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!initial){
        throw new NotFoundException(
          'Correction not found'
        );
      }

      assertLocation(u,initial.locationId);

      const investigation=await this.lockInvestigation(
        tx,initial.investigationId,u
      );

      await tx.$queryRaw`
        SELECT id
        FROM "PosFinancialCorrection"
        WHERE id=${id}::uuid
        FOR UPDATE
      `;

      const correction=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      assertLocation(u,correction.locationId);

      if(
        correction.investigationId!==investigation.id||
        correction.locationId!==investigation.locationId||
        correction.originalShiftId!==investigation.shiftId||
        correction.originalDeviceId!==investigation.deviceId||
        correction.payloadHash!==investigation.payloadHash||
        correction.refundAttemptId!==investigation.refundAttemptId||
        correction.exchangeAttemptId!==investigation.exchangeAttemptId||
        correction.correctionType!==this.correctionType(investigation)||
        !correction.amount.eq(investigation.amount)||
        !correction.amount.isFinite()||
        !correction.amount.isPositive()
      ){
        throw new ConflictException(
          'Correction execution identity mismatch'
        );
      }

      if(!this.canRecordExecution(
        correction,investigation,u
      )){
        throw new ForbiddenException(
          'Independent approved correction recorder required'
        );
      }

      const input=this.executionInput(
        dto,correction,investigation
      );

      const existing=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(existing){

        if(
          existing.id!==input.id||
          existing.recordedById!==u.id||
          existing.executionType!==input.executionType||
          existing.evidenceReference!==input.evidenceReference||
          existing.evidenceNote!==input.evidenceNote||
          existing.debitAccountCode!==input.debitAccountCode||
          existing.creditAccountCode!==input.creditAccountCode
        ){
          throw new ConflictException(
            'Correction execution already recorded with different identity'
          );
        }

        await this.verifyExecutionBatch(
          tx,existing,correction
        );

        const posting=
          await this.verifyPostedAccounting(
            tx,correction,existing
          );

        return {
          ...this.executionResponse(
            correction,existing,true
          ),
          accountingPosted:!!posting,
          postingId:posting?.id??null,
          journalId:posting?.journalId??null
        };
      }

      const reusedId=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{id:input.id}
        });

      if(reusedId){
        throw new ConflictException(
          'Execution idempotency key already used'
        );
      }

      await this.verifyOriginal(tx,investigation);

      if(
        process.env.POS_FINANCIAL_CORRECTION_RECORDING_ENABLED
          !=='true'
      ){
        throw new ConflictException(
          'Financial correction recording is disabled'
        );
      }

      this.approvedAccounts(
        correction,
        input.debitAccountCode,
        input.creditAccountCode
      );

      const recordedAt=new Date();

      if(
        !correction.reviewedAt||
        recordedAt<correction.reviewedAt
      ){
        throw new ConflictException(
          'Invalid correction execution chronology'
        );
      }

      const lockedPeriod=
        await tx.financePeriodLock.findFirst({
          where:{
            locationId:correction.locationId,
            periodStart:{lte:recordedAt},
            periodEnd:{gt:recordedAt}
          },
          select:{id:true}
        });

      if(lockedPeriod){
        throw new ConflictException(
          'Current correction accounting period is locked'
        );
      }

      const existingBatch=
        await tx.financePostingBatch.findFirst({
          where:{
            OR:[
              {
                sourceType:'POS_FINANCIAL_CORRECTION',
                sourceId:correction.id
              },
              {
                idempotencyKey:
                  `POS_CORRECTION:${correction.id}`
              }
            ]
          },
          select:{id:true}
        });

      if(existingBatch){
        throw new ConflictException(
          'Unlinked correction posting batch requires investigation'
        );
      }

      const zero=new Prisma.Decimal(0);

      const batch=await tx.financePostingBatch.create({
        data:{
          locationId:correction.locationId,
          sourceType:'POS_FINANCIAL_CORRECTION',
          sourceId:correction.id,
          idempotencyKey:
            `POS_CORRECTION:${correction.id}`,
          status:'STAGED',
          memo:
            `Verified POS correction ${correction.id}`,
          createdById:u.id,
          createdAt:recordedAt,
          lines:{
            create:[
              {
                accountCode:input.debitAccountCode,
                debit:correction.amount,
                credit:zero
              },
              {
                accountCode:input.creditAccountCode,
                debit:zero,
                credit:correction.amount
              }
            ]
          }
        },
        include:{lines:true}
      });

      const execution=
        await tx.posFinancialCorrectionExecution.create({
          data:{
            id:input.id,
            correctionId:correction.id,
            locationId:correction.locationId,
            amount:correction.amount,
            executionType:input.executionType,
            evidenceReference:input.evidenceReference,
            evidenceNote:input.evidenceNote,
            debitAccountCode:input.debitAccountCode,
            creditAccountCode:input.creditAccountCode,
            postingBatchId:batch.id,
            recordedById:u.id,
            recordedAt
          }
        });

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      await tx.auditLog.create({
        data:{
          actorId:u.id,
          action:'POS_FINANCIAL_CORRECTION_EXECUTION_RECORDED',
          entityType:'PosFinancialCorrectionExecution',
          entityId:execution.id,
          after:{
            correctionId:correction.id,
            investigationId:investigation.id,
            locationId:correction.locationId,
            correctionType:correction.correctionType,
            executionType:execution.executionType,
            amount:execution.amount.toFixed(2),
            currency:'PKR',
            evidenceReference:execution.evidenceReference,
            evidenceNote:execution.evidenceNote,
            postingBatchId:batch.id,
            debitAccountCode:execution.debitAccountCode,
            creditAccountCode:execution.creditAccountCode,
            recordedAt:recordedAt.toISOString(),
            accountingStaged:true,
            accountingPosted:false,
            paymentExecutionAuthorized:false,
            financialHoldReleased:false
          }
        }
      });

      return this.executionResponse(
        correction,execution,false
      );

    });
  }

  // R10_3D24_48D3E2_EXECUTION_STATUS

  @Get(':id/execution')
  async executionStatus(
    @Param('id') id:string,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    return this.db.$transaction(async tx=>{

      const correction=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!correction){
        throw new NotFoundException(
          'Correction not found'
        );
      }

      assertLocation(u,correction.locationId);

      const investigation=
        await tx.posPaymentReconciliation.findUniqueOrThrow({
          where:{id:correction.investigationId}
        });

      if(
        investigation.locationId!==correction.locationId||
        investigation.payloadHash!==correction.payloadHash||
        investigation.shiftId!==correction.originalShiftId||
        investigation.deviceId!==correction.originalDeviceId||
        investigation.refundAttemptId!==correction.refundAttemptId||
        investigation.exchangeAttemptId!==correction.exchangeAttemptId||
        !investigation.amount.eq(correction.amount)||
        correction.correctionType!==this.correctionType(investigation)
      ){
        throw new ConflictException(
          'Correction investigation integrity failure'
        );
      }

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(!execution){

        return {
          correctionId:id,
          correctionStatus:correction.status,
          correctionType:correction.correctionType,
          locationId:correction.locationId,
          amount:correction.amount.toFixed(2),
          currency:'PKR',
          executionRecorded:false,
          accountingStaged:false,
          accountingPosted:false,
          paymentExecutionAuthorized:false,
          financialHoldReleased:false,
          canRecordExecution:
            process.env.POS_FINANCIAL_CORRECTION_RECORDING_ENABLED==='true'&&
            this.canRecordExecution(
              correction,investigation,u
            )
        };
      }

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      const posting=
        await this.verifyPostedAccounting(
          tx,correction,execution
        );

      return {
        ...this.executionResponse(
          correction,execution,false
        ),
        accountingPosted:!!posting,
        postingId:posting?.id??null,
        journalId:posting?.journalId??null,
        canRecordExecution:false,
        integrityVerified:true
      };

    },{
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead
    });
  }

  // R10_3D24_48D3G1_COMPLETION_STATUS

  // R10_3D24_48D3G2_ATOMIC_JOURNAL_POSTING

  private canPostAccounting(
    correction:Correction,
    investigation:Investigation,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>,
    u:Principal
  ){

    return (
      u.roles.includes('SUPER_ADMIN')&&
      correction.status==='APPROVED'&&
      u.id!==execution.recordedById&&
      u.id!==correction.submittedById&&
      u.id!==investigation.paymentOperatorId
    );

  }

  private async verifyPostedAccounting(
    tx:Tx,
    correction:Correction,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>
  ){

    const posting=
      await tx.posFinancialCorrectionPosting.findUnique({
        where:{correctionId:correction.id}
      });

    const journals=
      await tx.financeJournal.findMany({
        where:{
          OR:[
            {
              sourceType:'POS_FINANCIAL_CORRECTION',
              sourceId:correction.id
            },
            {
              externalKey:`POS_CORRECTION:${correction.id}`
            }
          ]
        },
        include:{lines:true},
        take:2
      });

    if(!posting){

      if(journals.length){
        throw new ConflictException(
          'Orphan correction journal requires investigation'
        );
      }

      return null;

    }

    if(journals.length!==1){
      throw new ConflictException(
        'Correction journal uniqueness verification failed'
      );
    }

    const journal=journals[0];

    const investigation=
      await tx.posPaymentReconciliation.findUniqueOrThrow({
        where:{id:correction.investigationId}
      });

    if(
      posting.executionId!==execution.id||
      posting.postingBatchId!==execution.postingBatchId||
      posting.locationId!==correction.locationId||
      !posting.amount.eq(correction.amount)||
      posting.postedAt<execution.recordedAt||
      posting.postedById===execution.recordedById||
      posting.postedById===correction.submittedById||
      posting.postedById===investigation.paymentOperatorId||
      posting.postingNote.trim().length<10||
      journal.id!==posting.journalId||
      journal.locationId!==correction.locationId||
      journal.sourceType!=='POS_FINANCIAL_CORRECTION'||
      journal.sourceId!==correction.id||
      journal.externalKey!==`POS_CORRECTION:${correction.id}`||
      journal.status!=='POSTED'||
      journal.createdById!==posting.postedById||
      journal.createdAt.getTime()!==posting.postedAt.getTime()||
      journal.reversedById!==null||
      journal.reversedAt!==null||
      journal.reversalReason!==null||
      journal.lines.length!==2
    ){
      throw new ConflictException(
        'Posted correction accounting integrity failure'
      );
    }

    const debit=journal.lines.filter(line=>
      line.accountCode===execution.debitAccountCode&&
      line.debit.eq(correction.amount)&&
      line.credit.eq(0)
    );

    const credit=journal.lines.filter(line=>
      line.accountCode===execution.creditAccountCode&&
      line.credit.eq(correction.amount)&&
      line.debit.eq(0)
    );

    if(debit.length!==1||credit.length!==1){
      throw new ConflictException(
        'Posted correction journal does not balance'
      );
    }

    return posting;

  }

  private postingResponse(
    posting:Prisma.PosFinancialCorrectionPostingGetPayload<{}>,
    duplicate:boolean
  ){

    return {
      postingId:posting.id,
      correctionId:posting.correctionId,
      executionId:posting.executionId,
      postingBatchId:posting.postingBatchId,
      journalId:posting.journalId,
      locationId:posting.locationId,
      amount:posting.amount.toFixed(2),
      currency:'PKR',
      postedById:posting.postedById,
      postedAt:posting.postedAt,
      postingNote:posting.postingNote,
      completionState:'ACCOUNTING_POSTED',
      accountingStaged:true,
      accountingPosted:true,
      integrityVerified:true,
      financiallyClosed:false,
      financialHoldReleased:false,
      paymentExecutionAuthorized:false,
      duplicate
    };

  }

  @Post(':id/post-accounting')
  @Roles('SUPER_ADMIN')
  async postAccounting(
    @Param('id') id:string,
    @Body() dto:PostCorrectionAccountingDto,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    const postingId=this.uuid(dto.id);

    const note=this.clean(dto.note,10,1000);

    if(!u.roles.includes('SUPER_ADMIN')){
      throw new ForbiddenException(
        'HQ accounting posting authorization required'
      );
    }

    return this.transaction(async tx=>{

      await tx.$executeRaw`
        LOCK TABLE "FinancePeriodLock" IN SHARE MODE
      `;

      const initial=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!initial){
        throw new NotFoundException(
          'Financial correction not found'
        );
      }

      assertLocation(u,initial.locationId);

      const investigation=
        await this.lockInvestigation(
          tx,initial.investigationId,u
        );

      await tx.$queryRaw`
        SELECT id
        FROM "PosFinancialCorrection"
        WHERE id=${id}::uuid
        FOR UPDATE
      `;

      const correction=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      assertLocation(u,correction.locationId);

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(!execution){
        throw new ConflictException(
          'Verified execution evidence required'
        );
      }

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      if(!this.canPostAccounting(
        correction,investigation,execution,u
      )){
        throw new ForbiddenException(
          'Independent HQ accounting poster required'
        );
      }

      const existing=
        await this.verifyPostedAccounting(
          tx,correction,execution
        );

      if(existing){

        if(
          existing.id!==postingId||
          existing.postedById!==u.id||
          existing.postingNote!==note
        ){
          throw new ConflictException(
            'Correction already posted with different identity'
          );
        }

        return this.postingResponse(
          existing,true
        );

      }

      if(
        process.env.POS_FINANCIAL_CORRECTION_POSTING_ENABLED
          !=='true'
      ){
        throw new ConflictException(
          'Financial correction journal posting is disabled'
        );
      }

      await this.verifyOriginal(tx,investigation);

      // R10_3D24_48D3G4D3_PERIOD_TREATMENT

      const economicEvent=
        await this.verifyEconomicEvent(
          tx,correction,investigation,execution
        );

      if(!economicEvent){
        throw new ConflictException(
          'Verified economic event required before accounting posting'
        );
      }

      if(economicEvent.recordedById===u.id){
        throw new ForbiddenException(
          'Accounting poster must be independent of economic event recorder'
        );
      }

      const positiveTenderCount=[
        economicEvent.cashAmount,
        economicEvent.cardAmount,
        economicEvent.otherAmount
      ].filter(amount=>amount.gt(0)).length;

      if(positiveTenderCount!==1){
        throw new ConflictException(
          'Mixed-tender accounting requires dedicated account allocation'
        );
      }

      if(
        process.env.POS_FINANCIAL_CORRECTION_PERIOD_POLICY
          !=='CURRENT_PERIOD_ADJUSTMENT'
      ){
        throw new ConflictException(
          'Finance-approved accounting period policy is not configured'
        );
      }

      this.approvedAccounts(
        correction,
        execution.debitAccountCode,
        execution.creditAccountCode
      );

      const reused=
        await tx.posFinancialCorrectionPosting.findUnique({
          where:{id:postingId}
        });

      if(reused){
        throw new ConflictException(
          'Posting idempotency key already used'
        );
      }

      const postedAt=new Date();

      if(postedAt<execution.recordedAt){
        throw new ConflictException(
          'Invalid accounting posting chronology'
        );
      }

      const locked=
        await tx.financePeriodLock.findFirst({
          where:{
            locationId:correction.locationId,
            periodStart:{lte:postedAt},
            periodEnd:{gt:postedAt}
          },
          select:{id:true}
        });

      if(locked){
        throw new ConflictException(
          'Current accounting period is locked'
        );
      }

      const historicalPeriodLocks=
        await tx.financePeriodLock.findMany({
          where:{
            locationId:correction.locationId,
            periodStart:{lte:economicEvent.economicEventAt},
            periodEnd:{gt:economicEvent.economicEventAt}
          },
          select:{id:true},
          take:2
        });

      if(historicalPeriodLocks.length>1){
        throw new ConflictException(
          'Overlapping historical accounting period locks'
        );
      }

      const periodTreatment=
        historicalPeriodLocks.length===1
          ?'LOCKED_PERIOD_ADJUSTMENT'
          :'CURRENT_PERIOD_ADJUSTMENT';

      if(
        !note.startsWith(`[${periodTreatment}] `)||
        note.slice(periodTreatment.length+3).trim().length<20
      ){
        throw new BadRequestException(
          `Explicit ${periodTreatment} approval and justification required`
        );
      }

      if(postedAt<economicEvent.recordedAt){
        throw new ConflictException(
          'Accounting posting precedes economic evidence recording'
        );
      }

      const zero=new Prisma.Decimal(0);

      const journal=
        await tx.financeJournal.create({
          data:{
            locationId:correction.locationId,
            sourceType:'POS_FINANCIAL_CORRECTION',
            sourceId:correction.id,
            externalKey:`POS_CORRECTION:${correction.id}`,
            description:
              `Verified POS correction ${correction.id}; `+
              `economic event ${economicEvent.economicEventAt.toISOString()}; `+
              `treatment ${periodTreatment}`,
            status:'POSTED',
            createdById:u.id,
            createdAt:postedAt,
            lines:{
              create:[
                {
                  accountCode:execution.debitAccountCode,
                  description:'Verified correction debit',
                  debit:correction.amount,
                  credit:zero
                },
                {
                  accountCode:execution.creditAccountCode,
                  description:'Verified correction credit',
                  debit:zero,
                  credit:correction.amount
                }
              ]
            }
          }
        });

      const posting=
        await tx.posFinancialCorrectionPosting.create({
          data:{
            id:postingId,
            correctionId:correction.id,
            executionId:execution.id,
            postingBatchId:execution.postingBatchId,
            journalId:journal.id,
            locationId:correction.locationId,
            amount:correction.amount,
            postedById:u.id,
            postedAt,
            postingNote:note
          }
        });

      await this.verifyPostedAccounting(
        tx,correction,execution
      );

      await tx.auditLog.create({
        data:{
          actorId:u.id,
          action:'POS_FINANCIAL_CORRECTION_ACCOUNTING_POSTED',
          entityType:'PosFinancialCorrectionPosting',
          entityId:posting.id,
          after:{
            correctionId:correction.id,
            investigationId:investigation.id,
            executionId:execution.id,
            postingBatchId:execution.postingBatchId,
            journalId:journal.id,
            locationId:correction.locationId,
            amount:correction.amount.toFixed(2),
            currency:'PKR',
            postedAt:postedAt.toISOString(),
            postingNote:note,
            economicEventId:economicEvent.id,
            economicEventAt:
              economicEvent.economicEventAt.toISOString(),
            economicEventRecordedById:
              economicEvent.recordedById,
            cashAmount:economicEvent.cashAmount.toFixed(2),
            cardAmount:economicEvent.cardAmount.toFixed(2),
            otherAmount:economicEvent.otherAmount.toFixed(2),
            periodTreatment,
            historicalPeriodLockId:
              historicalPeriodLocks[0]?.id??null,
            accountingPosted:true,
            financialHoldReleased:false,
            paymentExecutionAuthorized:false
          }
        }
      });

      return this.postingResponse(
        posting,false
      );

    });

  }

  // R10_3D24_48D3G3_CLOSURE_AUTHORIZATION_API

  private canAuthorizeClosure(
    correction:Correction,
    investigation:Investigation,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>,
    posting:Prisma.PosFinancialCorrectionPostingGetPayload<{}>,
    u:Principal
  ){

    return (
      u.roles.includes('SUPER_ADMIN')&&
      correction.status==='APPROVED'&&
      u.id!==correction.submittedById&&
      u.id!==investigation.paymentOperatorId&&
      u.id!==execution.recordedById&&
      u.id!==posting.postedById
    );

  }

  private async verifyClosureAuthorization(
    tx:Tx,
    correction:Correction,
    investigation:Investigation,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>|null,
    posting:Prisma.PosFinancialCorrectionPostingGetPayload<{}>|null
  ){

    const closure=
      await tx.posFinancialCorrectionClosure.findUnique({
        where:{correctionId:correction.id}
      });

    if(!closure){
      return null;
    }

    if(
      !execution||
      !posting||
      correction.status!=='APPROVED'||
      investigation.status!=='APPROVED'||
      investigation.executionAbandoned!==true||
      closure.executionId!==execution.id||
      closure.postingId!==posting.id||
      closure.locationId!==correction.locationId||
      !closure.amount.eq(correction.amount)||
      closure.authorizedAt<posting.postedAt||
      closure.authorizedAt.getTime()>Date.now()||
      closure.authorizedById===correction.submittedById||
      closure.authorizedById===investigation.paymentOperatorId||
      closure.authorizedById===execution.recordedById||
      closure.authorizedById===posting.postedById||
      closure.closureNote.trim().length<20
    ){
      throw new ConflictException(
        'Financial closure authorization integrity failure'
      );
    }

    return closure;

  }

  private closureResponse(
    closure:Prisma.PosFinancialCorrectionClosureGetPayload<{}>,
    duplicate:boolean
  ){

    return {
      closureId:closure.id,
      correctionId:closure.correctionId,
      executionId:closure.executionId,
      postingId:closure.postingId,
      locationId:closure.locationId,
      amount:closure.amount.toFixed(2),
      currency:'PKR',
      authorizedById:closure.authorizedById,
      authorizedAt:closure.authorizedAt,
      closureNote:closure.closureNote,
      completionState:'CLOSURE_AUTHORIZED',
      executionRecorded:true,
      accountingStaged:true,
      accountingPosted:true,
      financialClosureAuthorized:true,
      financiallyClosed:false,
      financialHoldReleased:false,
      paymentExecutionAuthorized:false,
      integrityVerified:true,
      duplicate
    };

  }

  @Post(':id/authorize-closure')
  @Roles('SUPER_ADMIN')
  async authorizeClosure(
    @Param('id') id:string,
    @Body() dto:AuthorizeCorrectionClosureDto,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    const closureId=this.uuid(dto.id);
    const note=this.clean(dto.note,20,1000);

    if(!u.roles.includes('SUPER_ADMIN')){
      throw new ForbiddenException(
        'HQ financial closure authorization required'
      );
    }

    return this.transaction(async tx=>{

      const initial=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!initial){
        throw new NotFoundException(
          'Financial correction not found'
        );
      }

      assertLocation(u,initial.locationId);

      const investigation=
        await this.lockInvestigation(
          tx,initial.investigationId,u
        );

      await tx.$queryRaw`
        SELECT id
        FROM "PosFinancialCorrection"
        WHERE id=${id}::uuid
        FOR UPDATE
      `;

      const correction=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      assertLocation(u,correction.locationId);

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(!execution){
        throw new ConflictException(
          'Verified execution evidence required'
        );
      }

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      const posting=
        await this.verifyPostedAccounting(
          tx,correction,execution
        );

      if(!posting){
        throw new ConflictException(
          'Verified accounting posting required'
        );
      }

      if(!this.canAuthorizeClosure(
        correction,investigation,execution,posting,u
      )){
        throw new ForbiddenException(
          'Independent financial closure authorizer required'
        );
      }

      const existing=
        await this.verifyClosureAuthorization(
          tx,correction,investigation,execution,posting
        );

      if(existing){

        if(
          existing.id!==closureId||
          existing.authorizedById!==u.id||
          existing.closureNote!==note
        ){
          throw new ConflictException(
            'Closure already authorized with different identity'
          );
        }

        return this.closureResponse(
          existing,true
        );

      }

      if(
        process.env.POS_FINANCIAL_CORRECTION_CLOSURE_ENABLED
          !=='true'
      ){
        throw new ConflictException(
          'Financial closure authorization is disabled'
        );
      }

      await this.verifyOriginal(
        tx,investigation
      );

      const reused=
        await tx.posFinancialCorrectionClosure.findUnique({
          where:{id:closureId}
        });

      if(reused){
        throw new ConflictException(
          'Closure idempotency key already used'
        );
      }

      const authorizedAt=new Date();

      if(authorizedAt<posting.postedAt){
        throw new ConflictException(
          'Invalid financial closure chronology'
        );
      }

      const closure=
        await tx.posFinancialCorrectionClosure.create({
          data:{
            id:closureId,
            correctionId:correction.id,
            executionId:execution.id,
            postingId:posting.id,
            locationId:correction.locationId,
            amount:correction.amount,
            authorizedById:u.id,
            authorizedAt,
            closureNote:note
          }
        });

      await this.verifyClosureAuthorization(
        tx,correction,investigation,execution,posting
      );

      await tx.auditLog.create({
        data:{
          actorId:u.id,
          action:'POS_FINANCIAL_CORRECTION_CLOSURE_AUTHORIZED',
          entityType:'PosFinancialCorrectionClosure',
          entityId:closure.id,
          after:{
            correctionId:correction.id,
            investigationId:investigation.id,
            executionId:execution.id,
            postingId:posting.id,
            journalId:posting.journalId,
            locationId:correction.locationId,
            amount:correction.amount.toFixed(2),
            currency:'PKR',
            authorizedAt:authorizedAt.toISOString(),
            closureNote:note,
            financialClosureAuthorized:true,
            financiallyClosed:false,
            financialHoldReleased:false,
            paymentExecutionAuthorized:false
          }
        }
      });

      return this.closureResponse(
        closure,false
      );

    });

  }

  // R10_3D24_48D3G4C_RELEASE_API

  private canReleaseCorrection(
    correction:Correction,
    investigation:Investigation,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>,
    posting:Prisma.PosFinancialCorrectionPostingGetPayload<{}>,
    closure:Prisma.PosFinancialCorrectionClosureGetPayload<{}>,
    u:Principal
  ){

    return (
      u.roles.includes('SUPER_ADMIN')&&
      correction.status==='APPROVED'&&
      investigation.status==='APPROVED'&&
      investigation.executionAbandoned===true&&
      u.id!==correction.submittedById&&
      u.id!==investigation.paymentOperatorId&&
      u.id!==execution.recordedById&&
      u.id!==posting.postedById&&
      u.id!==closure.authorizedById
    );

  }

  private async verifyReleaseRecord(
    tx:Tx,
    correction:Correction,
    investigation:Investigation,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>|null,
    posting:Prisma.PosFinancialCorrectionPostingGetPayload<{}>|null,
    closure:Prisma.PosFinancialCorrectionClosureGetPayload<{}>|null
  ){

    const release=
      await tx.posFinancialCorrectionRelease.findUnique({
        where:{correctionId:correction.id}
      });

    if(!release){
      return null;
    }

    if(
      !execution||
      !posting||
      !closure||
      correction.status!=='APPROVED'||
      investigation.status!=='APPROVED'||
      investigation.executionAbandoned!==true||
      release.correctionId!==correction.id||
      release.closureId!==closure.id||
      release.locationId!==correction.locationId||
      !release.amount.eq(correction.amount)||
      release.releasedAt<closure.authorizedAt||
      release.releasedAt.getTime()>Date.now()||
      release.releasedById===correction.submittedById||
      release.releasedById===investigation.paymentOperatorId||
      release.releasedById===execution.recordedById||
      release.releasedById===posting.postedById||
      release.releasedById===closure.authorizedById||
      release.releaseNote.trim().length<20
    ){
      throw new ConflictException(
        'Financial release record integrity failure'
      );
    }

    return release;

  }

  private releaseIntegrationBlockers(
    correction:Correction
  ):string[]{

    const blockers=[
      'TENDER_RECONCILIATION_REQUIRED',
      'ECONOMIC_EVENT_DATE_VERIFICATION_REQUIRED',
      'FINANCE_PERIOD_TREATMENT_REQUIRED',
      'OPERATIONAL_RELEASE_INTEGRATION_REQUIRED',
      'RECIPROCAL_PAYMENT_SAFEGUARDS_REQUIRED'
    ];

    if(
      correction.correctionType===
      'CONTRADICTORY_REFUND_PAYMENT'
    ){
      blockers.push(
        'REFUND_ENTITLEMENT_RECONCILIATION_REQUIRED'
      );
    }

    if(
      correction.correctionType===
      'CONTRADICTORY_EXCHANGE_COLLECTION'
    ){
      blockers.push(
        'CUSTOMER_LIABILITY_DISPOSITION_REQUIRED'
      );
    }

    if(
      correction.correctionType===
      'UNRESOLVED_EXCHANGE_REVERSAL'
    ){
      blockers.push(
        'REVERSAL_DISPOSITION_VERIFICATION_REQUIRED'
      );
    }

    return blockers;

  }

  @Post(':id/release')
  @Roles('SUPER_ADMIN')
  async releaseCorrection(
    @Param('id') id:string,
    @Body() dto:ReleaseCorrectionDto,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    const releaseId=this.uuid(dto.id);
    const note=this.clean(dto.note,20,1000);

    if(!u.roles.includes('SUPER_ADMIN')){
      throw new ForbiddenException(
        'Independent HQ financial release required'
      );
    }

    return this.transaction(async tx=>{

      const initial=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!initial){
        throw new NotFoundException(
          'Financial correction not found'
        );
      }

      assertLocation(u,initial.locationId);

      const investigation=
        await this.lockInvestigation(
          tx,initial.investigationId,u
        );

      await tx.$queryRaw`
        SELECT id
        FROM "PosFinancialCorrection"
        WHERE id=${id}::uuid
        FOR UPDATE
      `;

      const correction=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      assertLocation(u,correction.locationId);

      if(
        correction.investigationId!==investigation.id||
        correction.locationId!==investigation.locationId||
        correction.originalShiftId!==investigation.shiftId||
        correction.originalDeviceId!==investigation.deviceId||
        correction.payloadHash!==investigation.payloadHash||
        correction.refundAttemptId!==investigation.refundAttemptId||
        correction.exchangeAttemptId!==investigation.exchangeAttemptId||
        !correction.amount.eq(investigation.amount)||
        this.correctionType(investigation)!==correction.correctionType
      ){
        throw new ConflictException(
          'Financial release identity mismatch'
        );
      }

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(!execution){
        throw new ConflictException(
          'Verified execution evidence required'
        );
      }

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      const posting=
        await this.verifyPostedAccounting(
          tx,correction,execution
        );

      if(!posting){
        throw new ConflictException(
          'Verified accounting posting required'
        );
      }

      const closure=
        await this.verifyClosureAuthorization(
          tx,correction,investigation,execution,posting
        );

      if(!closure){
        throw new ConflictException(
          'Independent closure authorization required'
        );
      }

      if(!this.canReleaseCorrection(
        correction,investigation,execution,posting,closure,u
      )){
        throw new ForbiddenException(
          'Independent financial release actor required'
        );
      }

      const existing=
        await this.verifyReleaseRecord(
          tx,correction,investigation,execution,posting,closure
        );

      if(existing){
        throw new ConflictException(
          'Existing release record requires operational reconciliation'
        );
      }

      const reused=
        await tx.posFinancialCorrectionRelease.findUnique({
          where:{id:releaseId}
        });

      if(reused){
        throw new ConflictException(
          'Financial release identity already used'
        );
      }

      await this.verifyOriginal(
        tx,investigation
      );

      const blockers=
        this.releaseIntegrationBlockers(correction);

      if(
        process.env.POS_FINANCIAL_CORRECTION_RELEASE_ENABLED
          !=='true'
      ){
        blockers.push(
          'FINANCIAL_RELEASE_DISABLED'
        );
      }

      // Deliberately fail closed until operational integration
      // can verify reconciliation using authoritative records.
      // A user-supplied note cannot satisfy these controls.

      throw new ConflictException({
        message:
          'Financial release is blocked pending final reconciliation',
        correctionId:correction.id,
        requestedReleaseId:releaseId,
        closureId:closure.id,
        releaseNoteAccepted:note.length>=20,
        completionState:'CLOSURE_AUTHORIZED',
        financialClosureAuthorized:true,
        financiallyClosed:false,
        financialHoldReleased:false,
        paymentExecutionAuthorized:false,
        blockers
      });

    });

  }

  // R10_3D24_48D3G4D2C_ECONOMIC_EVENT_API

  private async economicTenderAllocation(
    tx:Tx,
    correction:Correction
  ){

    let cash=new Prisma.Decimal(0);
    let card=new Prisma.Decimal(0);
    let other=new Prisma.Decimal(0);

    let registeredAt:Date;

    const tenders:{
      type:string;
      amount:string;
      reference:string|null;
    }[]=[];

    const add=(
      type:unknown,
      raw:unknown,
      reference:unknown
    )=>{

      if(
        typeof type!=='string'||
        !['CASH','CARD','OTHER'].includes(type)||
        (typeof raw!=='number'&&
         typeof raw!=='string')
      ){
        throw new ConflictException(
          'Invalid registered physical tender'
        );
      }

      let amount:Prisma.Decimal;

      try{
        amount=new Prisma.Decimal(raw);
      }catch{
        throw new ConflictException(
          'Invalid registered tender amount'
        );
      }

      if(
        !amount.isFinite()||
        !amount.isPositive()||
        amount.decimalPlaces()>2||
        amount.gt('9999999999.99')
      ){
        throw new ConflictException(
          'Invalid registered tender precision'
        );
      }

      const ref=
        typeof reference==='string'
          ?reference.trim()
          :'';

      if(type!=='CASH'&&!ref){
        throw new ConflictException(
          'Registered noncash reference missing'
        );
      }

      if(type==='CASH'){
        cash=cash.plus(amount);
      }else if(type==='CARD'){
        card=card.plus(amount);
      }else{
        other=other.plus(amount);
      }

      tenders.push({
        type,
        amount:amount.toFixed(2),
        reference:ref||null
      });

    };

    if(correction.refundAttemptId){

      const refund=
        await tx.posRefundAttempt.findUniqueOrThrow({
          where:{id:correction.refundAttemptId}
        });

      if(
        refund.locationId!==correction.locationId||
        refund.deviceId!==correction.originalDeviceId||
        refund.shiftId!==correction.originalShiftId||
        refund.payloadHash!==correction.payloadHash||
        !refund.amount.eq(correction.amount)
      ){
        throw new ConflictException(
          'Refund tender identity mismatch'
        );
      }

      const payload=
        refund.payload as Record<string,unknown>;

      registeredAt=refund.createdAt;

      add(
        refund.method,
        refund.amount.toFixed(2),
        payload?.reference
      );

    }else if(correction.exchangeAttemptId){

      const exchange=
        await tx.posExchangeAttempt.findUniqueOrThrow({
          where:{id:correction.exchangeAttemptId}
        });

      if(
        exchange.locationId!==correction.locationId||
        exchange.deviceId!==correction.originalDeviceId||
        exchange.shiftId!==correction.originalShiftId||
        exchange.payloadHash!==correction.payloadHash
      ){
        throw new ConflictException(
          'Exchange tender identity mismatch'
        );
      }

      registeredAt=exchange.createdAt;

      const payload=
        exchange.payload as Record<string,unknown>;

      const items=payload?.additionalTenders;

      if(
        !Array.isArray(items)||
        items.length<1||
        items.length>10
      ){
        throw new ConflictException(
          'Registered exchange tenders missing'
        );
      }

      for(const item of items){

        if(
          !item||
          typeof item!=='object'||
          typeof item.amount!=='number'
        ){
          throw new ConflictException(
            'Invalid exchange tender payload'
          );
        }

        add(
          item.type,
          item.amount,
          item.reference
        );

      }

    }else{

      throw new ConflictException(
        'Original financial attempt missing'
      );

    }

    if(
      !cash.plus(card).plus(other)
        .eq(correction.amount)
    ){
      throw new ConflictException(
        'Tender total differs from correction amount'
      );
    }

    const direction=
      correction.correctionType===
        'CONTRADICTORY_EXCHANGE_COLLECTION'
        ?'INFLOW'
        :'OUTFLOW';

    return {
      cash,
      card,
      other,
      direction,
      registeredAt,
      tenders
    };

  }

  private economicEventResponse(
    event:Prisma.PosFinancialCorrectionEconomicEventGetPayload<{}>,
    duplicate:boolean
  ){

    return {
      ...event,
      amount:event.amount.toFixed(2),
      cashAmount:event.cashAmount.toFixed(2),
      cardAmount:event.cardAmount.toFixed(2),
      otherAmount:event.otherAmount.toFixed(2),
      currency:'PKR',
      economicEventRecorded:true,
      financialHoldReleased:false,
      paymentExecutionAuthorized:false,
      duplicate
    };

  }

  private async verifyEconomicEvent(
    tx:Tx,
    correction:Correction,
    investigation:Investigation,
    execution:Prisma.PosFinancialCorrectionExecutionGetPayload<{}>
  ){

    const event=
      await tx.posFinancialCorrectionEconomicEvent.findUnique({
        where:{correctionId:correction.id}
      });

    if(!event){
      return null;
    }

    const allocation=
      await this.economicTenderAllocation(
        tx,correction
      );

    const shift=
      await tx.posShift.findUniqueOrThrow({
        where:{id:correction.originalShiftId}
      });

    if(
      event.executionId!==execution.id||
      event.locationId!==correction.locationId||
      event.originalShiftId!==correction.originalShiftId||
      !event.amount.eq(correction.amount)||
      !event.cashAmount.eq(allocation.cash)||
      !event.cardAmount.eq(allocation.card)||
      !event.otherAmount.eq(allocation.other)||
      event.direction!==allocation.direction||
      shift.locationId!==correction.locationId||
      shift.deviceId!==correction.originalDeviceId||
      event.economicEventAt<shift.openedAt||
      event.economicEventAt<allocation.registeredAt||
      event.economicEventAt>execution.recordedAt||
      event.recordedAt<execution.recordedAt||
      event.recordedAt.getTime()>Date.now()||
      event.recordedById===execution.recordedById||
      event.recordedById===correction.submittedById||
      event.recordedById===investigation.paymentOperatorId||
      event.evidenceReference.trim().length<5||
      event.evidenceNote.trim().length<20||
      this.normalize(event.evidenceReference)===
        this.normalize(investigation.evidenceReference)
    ){
      throw new ConflictException(
        'Economic event integrity verification failed'
      );
    }

    return event;

  }

  @Get(':id/economic-event')
  async economicEventStatus(
    @Param('id') id:string,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    return this.db.$transaction(async tx=>{

      const correction=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!correction){
        throw new NotFoundException(
          'Financial correction not found'
        );
      }

      assertLocation(u,correction.locationId);

      const investigation=
        await tx.posPaymentReconciliation.findUniqueOrThrow({
          where:{id:correction.investigationId}
        });

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(!execution){

        return {
          correctionId:id,
          economicEventRecorded:false,
          canRecordEconomicEvent:false,
          blockers:['VERIFIED_EXECUTION_REQUIRED'],
          financialHoldReleased:false,
          paymentExecutionAuthorized:false
        };

      }

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      const event=
        await this.verifyEconomicEvent(
          tx,correction,investigation,execution
        );

      const allocation=
        await this.economicTenderAllocation(
          tx,correction
        );

      if(event){

        return {
          ...this.economicEventResponse(event,false),
          integrityVerified:true,
          canRecordEconomicEvent:false
        };

      }

      await this.verifyOriginal(tx,investigation);

      return {
        correctionId:id,
        economicEventRecorded:false,
        expectedDirection:allocation.direction,
        expectedAmount:correction.amount.toFixed(2),
        expectedCashAmount:allocation.cash.toFixed(2),
        expectedCardAmount:allocation.card.toFixed(2),
        expectedOtherAmount:allocation.other.toFixed(2),
        currency:'PKR',
        earliestRegisteredAt:allocation.registeredAt,
        latestEconomicEventAt:execution.recordedAt,
        canRecordEconomicEvent:
          process.env.POS_FINANCIAL_CORRECTION_ECONOMIC_EVENT_ENABLED==='true'&&
          u.roles.includes('SUPER_ADMIN')&&
          u.id!==correction.submittedById&&
          u.id!==investigation.paymentOperatorId&&
          u.id!==execution.recordedById,
        financialHoldReleased:false,
        paymentExecutionAuthorized:false
      };

    },{
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead
    });

  }

  @Post(':id/economic-event')
  @Roles('SUPER_ADMIN')
  async recordEconomicEvent(
    @Param('id') id:string,
    @Body() dto:RecordEconomicEventDto,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    const eventId=this.uuid(dto.id);

    const evidenceReference=
      this.clean(dto.evidenceReference,5,200);

    const evidenceNote=
      this.clean(dto.evidenceNote,20,1000);

    const economicEventAt=
      new Date(dto.economicEventAt);

    if(
      !Number.isFinite(economicEventAt.getTime())||
      economicEventAt.toISOString()!==dto.economicEventAt
    ){
      throw new BadRequestException(
        'Canonical UTC economic event timestamp required'
      );
    }

    if(!u.roles.includes('SUPER_ADMIN')){
      throw new ForbiddenException(
        'Independent HQ economic event recorder required'
      );
    }

    return this.transaction(async tx=>{

      const initial=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!initial){
        throw new NotFoundException(
          'Financial correction not found'
        );
      }

      assertLocation(u,initial.locationId);

      const investigation=
        await this.lockInvestigation(
          tx,initial.investigationId,u
        );

      await tx.$queryRaw`
        SELECT id
        FROM "PosFinancialCorrection"
        WHERE id=${id}::uuid
        FOR UPDATE
      `;

      const correction=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      assertLocation(u,correction.locationId);

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      if(!execution){
        throw new ConflictException(
          'Verified execution evidence required'
        );
      }

      await this.verifyExecutionBatch(
        tx,execution,correction
      );

      if(
        u.id===correction.submittedById||
        u.id===investigation.paymentOperatorId||
        u.id===execution.recordedById
      ){
        throw new ForbiddenException(
          'Independent economic event recorder required'
        );
      }

      const existing=
        await this.verifyEconomicEvent(
          tx,correction,investigation,execution
        );

      if(existing){

        if(
          existing.id!==eventId||
          existing.recordedById!==u.id||
          existing.economicEventAt.getTime()!==
            economicEventAt.getTime()||
          existing.evidenceReference!==evidenceReference||
          existing.evidenceNote!==evidenceNote
        ){
          throw new ConflictException(
            'Economic event already recorded with different identity'
          );
        }

        return this.economicEventResponse(
          existing,true
        );

      }

      if(
        process.env.POS_FINANCIAL_CORRECTION_ECONOMIC_EVENT_ENABLED
          !=='true'
      ){
        throw new ConflictException(
          'Economic event recording is disabled'
        );
      }

      await this.verifyOriginal(
        tx,investigation
      );

      if(
        this.normalize(evidenceReference)===
        this.normalize(investigation.evidenceReference)
      ){
        throw new BadRequestException(
          'Contradictory investigation evidence cannot be reused'
        );
      }

      const allocation=
        await this.economicTenderAllocation(
          tx,correction
        );

      const shift=
        await tx.posShift.findUniqueOrThrow({
          where:{id:correction.originalShiftId}
        });

      if(
        economicEventAt<shift.openedAt||
        economicEventAt<allocation.registeredAt||
        economicEventAt>execution.recordedAt
      ){
        throw new BadRequestException(
          'Economic event chronology invalid'
        );
      }

      const reused=
        await tx.posFinancialCorrectionEconomicEvent.findUnique({
          where:{id:eventId}
        });

      if(reused){
        throw new ConflictException(
          'Economic event identity already used'
        );
      }

      const release=
        await tx.posFinancialCorrectionRelease.findUnique({
          where:{correctionId:id}
        });

      if(release){
        throw new ConflictException(
          'Released correction cannot receive new evidence'
        );
      }

      const event=
        await tx.posFinancialCorrectionEconomicEvent.create({
          data:{
            id:eventId,
            correctionId:correction.id,
            executionId:execution.id,
            locationId:correction.locationId,
            originalShiftId:correction.originalShiftId,
            economicEventAt,
            direction:allocation.direction,
            amount:correction.amount,
            cashAmount:allocation.cash,
            cardAmount:allocation.card,
            otherAmount:allocation.other,
            evidenceReference,
            evidenceNote,
            recordedById:u.id,
            recordedAt:new Date()
          }
        });

      await this.verifyEconomicEvent(
        tx,correction,investigation,execution
      );

      await tx.auditLog.create({
        data:{
          actorId:u.id,
          action:'POS_FINANCIAL_CORRECTION_ECONOMIC_EVENT_RECORDED',
          entityType:'PosFinancialCorrectionEconomicEvent',
          entityId:event.id,
          after:{
            correctionId:correction.id,
            executionId:execution.id,
            locationId:correction.locationId,
            originalShiftId:correction.originalShiftId,
            economicEventAt:economicEventAt.toISOString(),
            direction:event.direction,
            amount:event.amount.toFixed(2),
            cashAmount:event.cashAmount.toFixed(2),
            cardAmount:event.cardAmount.toFixed(2),
            otherAmount:event.otherAmount.toFixed(2),
            evidenceReference,
            evidenceNote,
            financialHoldReleased:false,
            paymentExecutionAuthorized:false
          }
        }
      });

      return this.economicEventResponse(
        event,false
      );

    });

  }

  @Get(':id/completion')
  async completionStatus(
    @Param('id') id:string,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    return this.db.$transaction(async tx=>{

      const correction=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!correction){
        throw new NotFoundException(
          'Financial correction not found'
        );
      }

      assertLocation(u,correction.locationId);

      const investigation=
        await tx.posPaymentReconciliation.findUniqueOrThrow({
          where:{id:correction.investigationId}
        });

      if(
        investigation.locationId!==correction.locationId||
        investigation.shiftId!==correction.originalShiftId||
        investigation.deviceId!==correction.originalDeviceId||
        investigation.payloadHash!==correction.payloadHash||
        investigation.refundAttemptId!==correction.refundAttemptId||
        investigation.exchangeAttemptId!==correction.exchangeAttemptId||
        !investigation.amount.eq(correction.amount)||
        this.correctionType(investigation)!==correction.correctionType
      ){
        throw new ConflictException(
          'Correction completion identity verification failed'
        );
      }

      const execution=
        await tx.posFinancialCorrectionExecution.findUnique({
          where:{correctionId:id}
        });

      const journal=
        await tx.financeJournal.findFirst({
          where:{
            OR:[
              {
                sourceType:'POS_FINANCIAL_CORRECTION',
                sourceId:id
              },
              {
                externalKey:`POS_CORRECTION:${id}`
              }
            ]
          },
          select:{
            id:true,
            status:true,
            locationId:true
          }
        });

      // R10_3D24_48D3G2_COMPLETION_INTEGRATION

      if(journal&&!execution){
        throw new ConflictException(
          'Correction journal has no execution evidence'
        );
      }

      const posting=execution
        ?await this.verifyPostedAccounting(
          tx,correction,execution
        )
        :null;

      const accountingPosted=!!posting;

      // R10_3D24_48D3G3_CLOSURE_COMPLETION

      const closure=
        await this.verifyClosureAuthorization(
          tx,correction,investigation,execution,posting
        );

      const financialClosureAuthorized=!!closure;

      // R10_3D24_48D3G4C_RELEASE_COMPLETION

      const release=
        await this.verifyReleaseRecord(
          tx,correction,investigation,execution,posting,closure
        );

      if(release){
        throw new ConflictException(
          'Financial release exists before operational reconciliation integration'
        );
      }

      const releaseActorEligible=
        !!execution&&
        !!posting&&
        !!closure&&
        this.canReleaseCorrection(
          correction,investigation,execution,posting,closure,u
        );

      const releaseIntegrationReady=false;

      let completionState:
        'AWAITING_APPROVAL'|
        'REJECTED'|
        'AWAITING_EXECUTION_EVIDENCE'|
        'ACCOUNTING_STAGED'|
        'ACCOUNTING_POSTED'|
        'CLOSURE_AUTHORIZED';

      let executionRecorded=false;
      let accountingStaged=false;
      let originalStateVerified=false;
      let postingBatchId:string|null=null;
      let executionId:string|null=null;

      if(correction.status==='PENDING'){

        if(execution){
          throw new ConflictException(
            'Pending correction has unauthorized execution'
          );
        }

        completionState='AWAITING_APPROVAL';

      }else if(correction.status==='REJECTED'){

        if(execution){
          throw new ConflictException(
            'Rejected correction has unauthorized execution'
          );
        }

        completionState='REJECTED';

      }else if(correction.status==='APPROVED'){

        await this.verifyOriginal(
          tx,investigation
        );

        originalStateVerified=true;

        if(execution){

          const batch=
            await this.verifyExecutionBatch(
              tx,execution,correction
            );

          executionRecorded=true;
          accountingStaged=true;
          postingBatchId=batch.id;
          executionId=execution.id;

          completionState=financialClosureAuthorized
            ?'CLOSURE_AUTHORIZED'
            :accountingPosted
              ?'ACCOUNTING_POSTED'
              :'ACCOUNTING_STAGED';

        }else{

          completionState=
            'AWAITING_EXECUTION_EVIDENCE';

        }

      }else{

        throw new ConflictException(
          'Unknown financial correction status'
        );

      }

      const blockers:string[]=[];

      if(correction.status==='PENDING'){
        blockers.push(
          'INDEPENDENT_APPROVAL_REQUIRED'
        );
      }

      if(correction.status==='REJECTED'){
        blockers.push(
          'CORRECTION_REJECTED'
        );
      }

      if(
        correction.status==='APPROVED'&&
        !executionRecorded
      ){
        blockers.push(
          'VERIFIED_EXECUTION_EVIDENCE_REQUIRED'
        );
      }

      if(accountingStaged&&!accountingPosted){
        blockers.push(
          'DEDICATED_JOURNAL_POSTING_REQUIRED'
        );
      }

      if(accountingPosted&&!financialClosureAuthorized){
        blockers.push(
          'FINANCIAL_CLOSURE_AUTHORIZATION_REQUIRED'
        );
      }

      if(financialClosureAuthorized){

        blockers.push(
          'FINAL_FINANCIAL_RECONCILIATION_REQUIRED',
          ...this.releaseIntegrationBlockers(correction)
        );

        if(
          process.env.POS_FINANCIAL_CORRECTION_RELEASE_ENABLED
            !=='true'
        ){
          blockers.push(
            'FINANCIAL_RELEASE_DISABLED'
          );
        }

      }

      return {

        correctionId:correction.id,
        investigationId:investigation.id,

        refundAttemptId:
          correction.refundAttemptId,

        exchangeAttemptId:
          correction.exchangeAttemptId,

        locationId:correction.locationId,
        originalShiftId:correction.originalShiftId,
        originalDeviceId:correction.originalDeviceId,

        correctionType:correction.correctionType,
        correctionStatus:correction.status,
        completionState,

        amount:correction.amount.toFixed(2),
        currency:'PKR',

        executionId,
        postingBatchId,
        executionRecorded,
        accountingStaged,

        accountingPosted,
        postingId:posting?.id??null,
        journalId:posting?.journalId??null,
        postedAt:posting?.postedAt??null,
        postedById:posting?.postedById??null,
        financialClosureAuthorized,
        closureId:closure?.id??null,
        closureAuthorizedById:closure?.authorizedById??null,
        closureAuthorizedAt:closure?.authorizedAt??null,
        closureNote:closure?.closureNote??null,
        financiallyClosed:false,
        financialHoldReleased:false,
        releaseId:null,
        releasedAt:null,
        releasedById:null,
        releaseNote:null,
        releaseRecordPresent:false,
        releaseIntegrationReady,
        releaseActorEligible,

        paymentExecutionAuthorized:false,
        originalExecutionAbandoned:true,
        originalStateVerified,

        integrityVerified:true,

        canRecordExecution:
          !execution&&
          process.env.POS_FINANCIAL_CORRECTION_RECORDING_ENABLED==='true'&&
          this.canRecordExecution(
            correction,investigation,u
          ),

        canPostAccounting:
          !!execution&&
          !accountingPosted&&
          originalStateVerified&&
          process.env.POS_FINANCIAL_CORRECTION_POSTING_ENABLED==='true'&&
          this.canPostAccounting(
            correction,investigation,execution,u
          ),
        canAuthorizeClosure:
          !!execution&&
          !!posting&&
          !closure&&
          originalStateVerified&&
          process.env.POS_FINANCIAL_CORRECTION_CLOSURE_ENABLED==='true'&&
          this.canAuthorizeClosure(
            correction,investigation,execution,posting,u
          ),
        canReleaseFinancialHold:false,

        blockers,

        verifiedAt:new Date().toISOString()

      };

    },{
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead
    });

  }

  @Get('eligible')
  async eligible(
    @Query('locationId') locationId:string,
    @CurrentUser() u:Principal
  ){

    locationId=this.uuid(locationId);

    assertLocation(u,locationId);

    return this.db.$transaction(async tx=>{

      const investigations=
        await tx.posPaymentReconciliation.findMany({
          where:{
            locationId,
            status:'APPROVED',
            executionAbandoned:true,
            OR:[
              {
                kind:'REFUND_PAYOUT',
                proposedOutcome:'NOT_PAID'
              },
              {
                kind:'EXCHANGE_COLLECTION',
                proposedOutcome:'NOT_COLLECTED'
              },
              {
                kind:'EXCHANGE_REVERSAL',
                proposedOutcome:'NOT_REVERSED'
              }
            ]
          },
          orderBy:[
            {reviewedAt:'desc'},
            {id:'desc'}
          ],
          take:201
        });

      const rows=[];

      for(const i of investigations.slice(0,200)){

        try{

          const type=await this.verifyOriginal(tx,i);

          const active=
            await tx.posFinancialCorrection.findFirst({
              where:{
                status:{in:['PENDING','APPROVED']},
                OR:[
                  {investigationId:i.id},
                  ...(i.refundAttemptId?
                    [{refundAttemptId:i.refundAttemptId}]:[]),
                  ...(i.exchangeAttemptId?
                    [{exchangeAttemptId:i.exchangeAttemptId}]:[])
                ]
              },
              select:{id:true,status:true}
            });

          if(!active){

            rows.push({
              investigationId:i.id,
              correctionType:type,
              refundAttemptId:i.refundAttemptId,
              exchangeAttemptId:i.exchangeAttemptId,
              locationId:i.locationId,
              originalShiftId:i.shiftId,
              originalDeviceId:i.deviceId,
              amount:i.amount.toFixed(2),
              currency:'PKR',
              reviewedAt:i.reviewedAt,
              paymentExecutionAuthorized:false
            });
          }

        }catch(error){

          if(!(error instanceof ConflictException)){
            throw error;
          }
        }
      }

      return {
        locationId,
        rows,
        truncated:investigations.length>200,
        paymentExecutionAuthorized:false
      };

    },{
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout:30000
    });
  }

  @Get()
  async list(
    @Query('locationId') locationId:string,
    @Query('status') status:string|undefined,
    @CurrentUser() u:Principal
  ){

    locationId=this.uuid(locationId);

    assertLocation(u,locationId);

    if(
      status!==undefined&&
      !['PENDING','APPROVED','REJECTED'].includes(status)
    ){
      throw new BadRequestException(
        'Invalid correction status'
      );
    }

    return this.db.$transaction(async tx=>{

      const records=
        await tx.posFinancialCorrection.findMany({
          where:{
            locationId,
            ...(status?{status}:{})
          },
          orderBy:[
            {submittedAt:'desc'},
            {id:'desc'}
          ],
          take:201
        });

      const investigations=
        await tx.posPaymentReconciliation.findMany({
          where:{
            id:{
              in:records.map(r=>r.investigationId)
            }
          }
        });

      const byId=new Map(
        investigations.map(i=>[i.id,i])
      );

      const rows=records.slice(0,200).map(record=>{

        const i=byId.get(record.investigationId);

        if(!i||i.locationId!==record.locationId){
          throw new ConflictException(
            'Correction investigation integrity failure'
          );
        }

        return this.response(record,i,u);
      });

      return {
        locationId,
        rows,
        truncated:records.length>200,
        paymentExecutionAuthorized:false
      };

    },{
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead
    });
  }

  @Get(':id')
  async detail(
    @Param('id') id:string,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    return this.db.$transaction(async tx=>{

      const record=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!record){
        throw new NotFoundException(
          'Correction not found'
        );
      }

      assertLocation(u,record.locationId);

      const i=
        await tx.posPaymentReconciliation.findUniqueOrThrow({
          where:{id:record.investigationId}
        });

      if(i.locationId!==record.locationId){
        throw new ConflictException(
          'Correction investigation integrity failure'
        );
      }

      return this.response(record,i,u);

    },{
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead
    });
  }

  @Post()
  async register(
    @Body() dto:RegisterCorrectionDto,
    @CurrentUser() u:Principal
  ){

    const id=this.uuid(dto.id);

    const investigationId=
      this.uuid(dto.investigationId);

    const evidenceReference=
      this.clean(dto.evidenceReference,5,200);

    const reason=this.clean(dto.reason,10,1000);

    return this.transaction(async tx=>{

      const i=await this.lockInvestigation(
        tx,investigationId,u
      );

      const existing=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(existing){

        assertLocation(u,existing.locationId);

        if(
          existing.investigationId!==investigationId||
          existing.submittedById!==u.id||
          existing.evidenceReference!==evidenceReference||
          existing.reason!==reason
        ){
          throw new ConflictException(
            'Correction idempotency identity mismatch'
          );
        }

        return {
          ...this.response(existing,i,u),
          duplicate:true
        };
      }

      const correctionType=
        await this.verifyOriginal(tx,i);

      if(
        this.normalize(evidenceReference)===
        this.normalize(i.evidenceReference)
      ){
        throw new BadRequestException(
          'New independent evidence required'
        );
      }

      const previous=
        await tx.posFinancialCorrection.findMany({
          where:{
            OR:[
              {investigationId:i.id},
              ...(i.refundAttemptId?
                [{refundAttemptId:i.refundAttemptId}]:[]),
              ...(i.exchangeAttemptId?
                [{exchangeAttemptId:i.exchangeAttemptId}]:[])
            ]
          },
          select:{
            id:true,
            status:true,
            evidenceReference:true
          }
        });

      if(previous.some(r=>
        ['PENDING','APPROVED'].includes(r.status)
      )){
        throw new ConflictException(
          'Active correction already exists'
        );
      }

      if(previous.some(r=>
        this.normalize(r.evidenceReference)===
        this.normalize(evidenceReference)
      )){
        throw new ConflictException(
          'Previously submitted evidence cannot be reused'
        );
      }

      const record=
        await tx.posFinancialCorrection.create({
          data:{
            id,
            investigationId:i.id,
            refundAttemptId:i.refundAttemptId,
            exchangeAttemptId:i.exchangeAttemptId,
            locationId:i.locationId,
            originalShiftId:i.shiftId,
            originalDeviceId:i.deviceId,
            payloadHash:i.payloadHash,
            correctionType,
            amount:i.amount,
            evidenceReference,
            reason,
            status:'PENDING',
            submittedById:u.id
          }
        });

      await tx.auditLog.create({
        data:{
          actorId:u.id,
          action:'POS_FINANCIAL_CORRECTION_REGISTERED',
          entityType:'PosFinancialCorrection',
          entityId:record.id,
          after:{
            investigationId:i.id,
            locationId:i.locationId,
            correctionType,
            amount:i.amount.toFixed(2),
            evidenceReference,
            reason,
            status:'PENDING',
            paymentExecutionAuthorized:false
          }
        }
      });

      return {
        ...this.response(record,i,u),
        duplicate:false
      };
    });
  }

  @Post(':id/review')
  @Roles('SUPER_ADMIN')
  async review(
    @Param('id') id:string,
    @Body() dto:ReviewCorrectionDto,
    @CurrentUser() u:Principal
  ){

    id=this.uuid(id);

    if(!u.roles.includes('SUPER_ADMIN')){
      throw new ForbiddenException('HQ review required');
    }

    if(!['APPROVED','REJECTED'].includes(dto.decision)){
      throw new BadRequestException(
        'Invalid review decision'
      );
    }

    const note=this.clean(dto.note,10,1000);

    return this.transaction(async tx=>{

      const initial=
        await tx.posFinancialCorrection.findUnique({
          where:{id}
        });

      if(!initial){
        throw new NotFoundException(
          'Correction not found'
        );
      }

      const i=await this.lockInvestigation(
        tx,initial.investigationId,u
      );

      const record=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      assertLocation(u,record.locationId);

      if(
        record.submittedById===u.id||
        i.paymentOperatorId===u.id||
        i.submittedById===u.id||
        i.reviewedById===u.id
      ){
        throw new ForbiddenException(
          'Independent HQ reviewer required'
        );
      }

      if(record.status!=='PENDING'){

        if(
          record.status===dto.decision&&
          record.reviewedById===u.id&&
          record.reviewNote===note
        ){
          return {
            ...this.response(record,i,u),
            duplicate:true
          };
        }

        throw new ConflictException(
          'Correction already reviewed'
        );
      }

      if(
        record.locationId!==i.locationId||
        record.originalShiftId!==i.shiftId||
        record.originalDeviceId!==i.deviceId||
        record.payloadHash!==i.payloadHash||
        record.refundAttemptId!==i.refundAttemptId||
        record.exchangeAttemptId!==i.exchangeAttemptId||
        record.correctionType!==this.correctionType(i)||
        !record.amount.eq(i.amount)
      ){
        throw new ConflictException(
          'Correction identity mismatch'
        );
      }

      if(dto.decision==='APPROVED'){
        await this.verifyOriginal(tx,i);
      }

      const reviewedAt=new Date();

      const changed=
        await tx.posFinancialCorrection.updateMany({
          where:{
            id,
            status:'PENDING'
          },
          data:{
            status:dto.decision,
            reviewedById:u.id,
            reviewedAt,
            reviewNote:note
          }
        });

      if(changed.count!==1){
        throw new ConflictException(
          'Concurrent correction review detected'
        );
      }

      await tx.auditLog.create({
        data:{
          actorId:u.id,
          action:`POS_FINANCIAL_CORRECTION_${dto.decision}`,
          entityType:'PosFinancialCorrection',
          entityId:id,
          before:{
            status:'PENDING'
          },
          after:{
            investigationId:i.id,
            locationId:i.locationId,
            status:dto.decision,
            reviewedById:u.id,
            reviewedAt:reviewedAt.toISOString(),
            note,
            paymentExecutionAuthorized:false,
            accountingPosted:false,
            financialHoldReleased:false
          }
        }
      });

      const updated=
        await tx.posFinancialCorrection.findUniqueOrThrow({
          where:{id}
        });

      return {
        ...this.response(updated,i,u),
        duplicate:false
      };
    });
  }
}
