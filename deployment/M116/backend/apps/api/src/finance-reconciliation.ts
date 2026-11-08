import { BadRequestException, ConflictException, Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-reconciliation')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceReconciliationController {
  constructor(private readonly db:Db) {}

  // M60: read-only accounting lock coverage and outstanding controls, not global enforcement.
  @Get('period-exposure')
  async periodExposure(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    const [locks,staged,pending]=await Promise.all([
      this.db.financePeriodLock.findMany({where:{locationId},orderBy:{periodStart:'desc'},take:100}),
      this.db.financePostingBatch.count({where:{locationId,status:'STAGED'}}),
      this.db.supplierPaymentRequest.count({where:{warehouseId:locationId,status:'PENDING'}})
    ]);
    return {locationId,locks,stagedBatches:staged,pendingPaymentRequests:pending,
      warning:'Diagnostic only. Some legacy financial write routes may still bypass period locks.'};
  }

  // M61: capture external settlement evidence for an approved request, once.
  @Post('settlements/:requestId')
  async recordSettlement(@Param('requestId') requestId:string,
    @Body() body:{settledAt:string;bankReference:string;evidenceNote:string},
    @CurrentUser() user:Principal){
    if(!body.bankReference?.trim()||!body.evidenceNote?.trim()||!body.settledAt)
      throw new BadRequestException('Settlement date, bank reference and evidence note required');
    const settledAt=new Date(body.settledAt);
    if(Number.isNaN(settledAt.getTime())||settledAt.getTime()>Date.now())
      throw new BadRequestException('Settlement date must be valid and not in the future');
    const request=await this.db.supplierPaymentRequest.findUnique({where:{id:requestId}});
    if(!request)throw new BadRequestException('Payment request not found');
    assertLocation(user,request.warehouseId);
    if(request.status!=='APPROVED')throw new ConflictException('Payment request must be approved');
    if(request.requestedById===user.id)
      throw new ConflictException('Requester cannot record own settlement evidence');
    const lock=await this.db.financePeriodLock.findFirst({where:{
      locationId:request.warehouseId,periodStart:{lte:settledAt},periodEnd:{gt:settledAt}
    }});
    if(lock)throw new ConflictException('Settlement date is within a locked accounting period');
    try {
      return await this.db.supplierPaymentSettlement.create({data:{
        paymentRequestId:request.id,invoiceId:request.invoiceId,warehouseId:request.warehouseId,
        amount:request.amount,settledAt,bankReference:body.bankReference.trim(),
        evidenceNote:body.evidenceNote.trim(),recordedById:user.id
      }});
    }catch(e){
      if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')
        throw new ConflictException('Settlement evidence already recorded for this request');
      throw e;
    }
  }

  @Get('invoice/:invoiceId')
  async invoiceReconciliation(@Param('invoiceId') invoiceId:string,@CurrentUser() user:Principal){
    const invoice=await this.db.supplierInvoice.findUnique({where:{id:invoiceId}});
    if(!invoice)throw new BadRequestException('Invoice not found');
    assertLocation(user,invoice.warehouseId);
    const [requests,settlements]=await Promise.all([
      this.db.supplierPaymentRequest.findMany({where:{invoiceId},orderBy:{createdAt:'asc'},take:1000}),
      this.db.supplierPaymentSettlement.findMany({where:{invoiceId},orderBy:{settledAt:'asc'},take:1000})
    ]);
    const settled=settlements.reduce((s,x)=>s.plus(x.amount),new Prisma.Decimal(0));
    return {invoiceId,invoiceTotal:invoice.totalAmount.toString(),
      recordedSettlements:settled.toString(),
      remainingByRecordedEvidence:invoice.totalAmount.minus(settled).toString(),
      requests,settlements,
      warning:'Evidence entered by users; no external bank verification. Incomplete if 1000-row cap is reached.'};
  }

  // M62: location-scoped HQ overview, with explicit data-source provenance.
  @Get('hq-overview')
  async hqOverview(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    const [latest,pending,approved,settled,staged,locks]=await Promise.all([
      this.db.financeSnapshot.findFirst({where:{locationId},orderBy:{snapshotDate:'desc'}}),
      this.db.supplierPaymentRequest.aggregate({where:{warehouseId:locationId,status:'PENDING'},_sum:{amount:true},_count:{_all:true}}),
      this.db.supplierPaymentRequest.aggregate({where:{warehouseId:locationId,status:'APPROVED'},_sum:{amount:true},_count:{_all:true}}),
      this.db.supplierPaymentSettlement.aggregate({where:{warehouseId:locationId},_sum:{amount:true},_count:{_all:true}}),
      this.db.financePostingBatch.count({where:{locationId,status:'STAGED'}}),
      this.db.financePeriodLock.count({where:{locationId}})
    ]);
    return {locationId,latestManagementSnapshot:latest,
      pendingRequests:{count:pending._count._all,amount:pending._sum.amount?.toString()??'0'},
      approvedRequests:{count:approved._count._all,amount:approved._sum.amount?.toString()??'0'},
      recordedSettlementEvidence:{count:settled._count._all,amount:settled._sum.amount?.toString()??'0'},
      stagedPostingBatches:staged,registeredPeriodLocks:locks,
      warning:'Backend overview only. Settlement evidence is not bank-verified; snapshots are manually entered; no automatic P&L or cross-branch consolidation.'};
  }
}
