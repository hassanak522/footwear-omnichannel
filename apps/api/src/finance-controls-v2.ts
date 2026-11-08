import { BadRequestException, ConflictException, GoneException, Controller, Get, Param, Post, Body, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-controls-v2')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceControlsV2Controller {
  constructor(private readonly db: Db) {}

  // M48: stage a balanced posting for a reviewed supplier invoice.
  // Explicitly NOT a live general-ledger posting or supplier payment.
  @Post('stage-invoice/:invoiceId')
  async stageInvoice(@Param('invoiceId') invoiceId:string,
    @Body() body:{idempotencyKey:string;expenseAccountCode:string;payableAccountCode:string;memo:string},
    @CurrentUser() user:Principal) {
    const invoice=await this.db.supplierInvoice.findUnique({where:{id:invoiceId}});
    if(!invoice) throw new BadRequestException('Invoice not found');
    assertLocation(user,invoice.warehouseId);
    const periodLock=await this.db.financePeriodLock.findFirst({where:{
      locationId:invoice.warehouseId,periodStart:{lte:invoice.invoiceDate},
      periodEnd:{gt:invoice.invoiceDate}
    }});
    if(periodLock)throw new ConflictException('Invoice accounting period is locked');
    if(invoice.status!=='REVIEWED') throw new BadRequestException('Invoice must be reviewed');
    if(!body.idempotencyKey?.trim()||!body.memo?.trim()||
       !/^[A-Za-z0-9_-]{2,32}$/.test(body.expenseAccountCode||'')||
       !/^[A-Za-z0-9_-]{2,32}$/.test(body.payableAccountCode||'')||
       body.expenseAccountCode===body.payableAccountCode)
      throw new BadRequestException('Valid idempotency key, distinct account codes and memo required');
    if(invoice.totalAmount.lte(0))throw new BadRequestException('Invoice amount must be positive');
    try {
      return await this.db.financePostingBatch.create({data:{
        locationId:invoice.warehouseId,sourceType:'SUPPLIER_INVOICE',sourceId:invoice.id,
        idempotencyKey:body.idempotencyKey.trim(),memo:body.memo.trim(),createdById:user.id,
        lines:{create:[
          {accountCode:body.expenseAccountCode,debit:invoice.totalAmount,credit:new Prisma.Decimal(0)},
          {accountCode:body.payableAccountCode,debit:new Prisma.Decimal(0),credit:invoice.totalAmount}
        ]}
      },include:{lines:true}});
    } catch(e) {
      if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')
        throw new ConflictException('Invoice already staged or idempotency key already used');
      throw e;
    }
  }

  // M49: approval workflow only. Approval does NOT record bank settlement.
  // M57: legacy endpoint retired; use controlled-payment-request.
  @Post('payment-requests')
  async requestPayment() {
    throw new GoneException('Use /api/v1/finance-guardrails/controlled-payment-request');
  }

  @Post('payment-requests/:id/decision')
  async decide(@Param('id') id:string,@Body() body:{decision:string;note:string},
    @CurrentUser() user:Principal) {
    if(!['APPROVED','REJECTED'].includes(body.decision)||!body.note?.trim())
      throw new BadRequestException('APPROVED or REJECTED and a reason required');
    const req=await this.db.supplierPaymentRequest.findUnique({where:{id}});
    if(!req)throw new BadRequestException('Payment request not found');
    assertLocation(user,req.warehouseId);
    if(req.requestedById===user.id)throw new BadRequestException('Self-approval is prohibited');
    const updated=await this.db.supplierPaymentRequest.updateMany({
      where:{id,status:'PENDING'},data:{status:body.decision,note:body.note.trim(),reviewedById:user.id,reviewedAt:new Date()}
    });
    if(updated.count!==1)throw new ConflictException('Payment request already decided');
    return this.db.supplierPaymentRequest.findUniqueOrThrow({where:{id}});
  }

  // M50: location-level HQ summaries of recorded snapshots and pending approvals.
  // This is NOT automated cross-location financial consolidation.
  @Get('hq-summary')
  async summary(@Query('locationId') locationId:string,@CurrentUser() user:Principal) {
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    const [snapshots,pending,staged]=await Promise.all([
      this.db.financeSnapshot.findMany({where:{locationId},orderBy:{snapshotDate:'desc'},take:30}),
      this.db.supplierPaymentRequest.aggregate({where:{warehouseId:locationId,status:'PENDING'},
        _count:{_all:true},_sum:{amount:true}}),
      this.db.financePostingBatch.count({where:{locationId,status:'STAGED'}})
    ]);
    return {locationId,snapshots,pendingPaymentRequests:pending._count._all,
      pendingPaymentAmount:pending._sum.amount?.toString()??'0',stagedPostingBatches:staged,
      warning:'Snapshots are manually entered; staged postings are not general-ledger entries; approvals do not confirm bank payments.'};
  }
}
