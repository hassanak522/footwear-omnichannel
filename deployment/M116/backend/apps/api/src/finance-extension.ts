import { BadRequestException, ConflictException, Controller, Get, Param, Post, Body, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-extension')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceExtensionController {
  constructor(private readonly db: Db) {}

  // M45: payment/credit events are append-only; no invoice or journal mutation.
  @Post('payables/:invoiceId/events')
  async payableEvent(@Param('invoiceId') invoiceId: string,
    @Body() body: {kind:string;amount:number;reference:string;idempotencyKey:string;note:string},
    @CurrentUser() user: Principal) {
    const invoice=await this.db.supplierInvoice.findUnique({where:{id:invoiceId}});
    if(!invoice) throw new BadRequestException('Invoice not found');
    assertLocation(user,invoice.warehouseId);
    if(!['INVOICE','PAYMENT','CREDIT'].includes(body.kind) ||
       !Number.isFinite(body.amount) || body.amount<=0 ||
       !body.reference?.trim() || !body.idempotencyKey?.trim() || !body.note?.trim())
      throw new BadRequestException('Invalid payable event');
    try {
      return await this.db.supplierPayableEvent.create({data:{
        supplierInvoiceId:invoiceId,warehouseId:invoice.warehouseId,
        kind:body.kind,amount:new Prisma.Decimal(body.amount.toFixed(2)),
        reference:body.reference.trim(),idempotencyKey:body.idempotencyKey.trim(),
        note:body.note.trim(),createdById:user.id
      }});
    } catch(e) {
      if(e instanceof Prisma.PrismaClientKnownRequestError && e.code==='P2002')
        throw new ConflictException('Duplicate payable event');
      throw e;
    }
  }

  @Get('payables/:invoiceId')
  async payableBalance(@Param('invoiceId') invoiceId:string,@CurrentUser() user:Principal) {
    const invoice=await this.db.supplierInvoice.findUnique({where:{id:invoiceId}});
    if(!invoice) throw new BadRequestException('Invoice not found');
    assertLocation(user,invoice.warehouseId);
    const events=await this.db.supplierPayableEvent.findMany({
      where:{supplierInvoiceId:invoiceId},orderBy:{createdAt:'asc'},take:5000
    });
    let balance=new Prisma.Decimal(0);
    for(const e of events) balance=e.kind==='INVOICE'?balance.plus(e.amount):balance.minus(e.amount);
    return {invoiceId,invoiceTotal:invoice.totalAmount.toString(),
      eventBalance:balance.toString(),events,
      warning:'Event balance is informational. It is not reconciled with general ledger or bank payments.',
      truncated:events.length===5000};
  }

  // M46: append cost history and update current cost in one transaction.
  @Post('cost-revisions')
  async reviseCost(@Body() body:{locationId:string;variantId:string;unitCost:number;reason:string},
    @CurrentUser() user:Principal) {
    assertLocation(user,body.locationId);
    const now=new Date();
    const periodLock=await this.db.financePeriodLock.findFirst({where:{
      locationId:body.locationId,periodStart:{lte:now},periodEnd:{gt:now}
    }});
    if(periodLock)throw new ConflictException('Current accounting period is locked');
    if(!Number.isFinite(body.unitCost)||body.unitCost<0||!body.reason?.trim())
      throw new BadRequestException('Invalid cost revision');
    const newCost=new Prisma.Decimal(body.unitCost.toFixed(2));
    return this.db.$transaction(async tx=>{
      const previous=await tx.inventoryCostBasis.findUnique({
        where:{locationId_variantId:{locationId:body.locationId,variantId:body.variantId}}
      });
      const current=await tx.inventoryCostBasis.upsert({
        where:{locationId_variantId:{locationId:body.locationId,variantId:body.variantId}},
        create:{locationId:body.locationId,variantId:body.variantId,unitCost:newCost,
          sourceNote:body.reason.trim(),enteredById:user.id},
        update:{unitCost:newCost,sourceNote:body.reason.trim(),enteredById:user.id}
      });
      const revision=await tx.inventoryCostRevision.create({data:{
        locationId:body.locationId,variantId:body.variantId,
        previousCost:previous?.unitCost??null,newCost,
        reason:body.reason.trim(),actorId:user.id
      }});
      return {current,revision};
    });
  }

  @Get('cost-revisions')
  async costHistory(@Query('locationId') locationId:string,@Query('variantId') variantId:string,
    @CurrentUser() user:Principal) {
    if(!locationId||!variantId)throw new BadRequestException('locationId and variantId required');
    assertLocation(user,locationId);
    return this.db.inventoryCostRevision.findMany({
      where:{locationId,variantId},orderBy:{createdAt:'desc'},take:200
    });
  }

  // M47: management-provided snapshot; clearly distinguished from calculated/audited figures.
  @Post('snapshots')
  async snapshot(@Body() body:{locationId:string;snapshotDate:string;cashSales:number;
    receivables:number;payables:number;estimatedStockValue:number;missingCostVariants:number;sourceNote:string},
    @CurrentUser() user:Principal) {
    assertLocation(user,body.locationId);
    const date=new Date(body.snapshotDate);
    if(Number.isNaN(date.getTime())||!body.sourceNote?.trim()||
      !Number.isInteger(body.missingCostVariants)||body.missingCostVariants<0||
      ![body.cashSales,body.receivables,body.payables,body.estimatedStockValue]
        .every(v=>Number.isFinite(v)&&v>=0))
      throw new BadRequestException('Invalid management snapshot');
    try {
      return await this.db.financeSnapshot.create({data:{
        locationId:body.locationId,snapshotDate:date,
        cashSales:new Prisma.Decimal(body.cashSales.toFixed(2)),
        receivables:new Prisma.Decimal(body.receivables.toFixed(2)),
        payables:new Prisma.Decimal(body.payables.toFixed(2)),
        estimatedStockValue:new Prisma.Decimal(body.estimatedStockValue.toFixed(2)),
        missingCostVariants:body.missingCostVariants,
        sourceNote:body.sourceNote.trim(),createdById:user.id
      }});
    } catch(e) {
      if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')
        throw new ConflictException('Snapshot already exists for this location and date');
      throw e;
    }
  }

  @Get('snapshots')
  async snapshots(@Query('locationId') locationId:string,@CurrentUser() user:Principal) {
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    return this.db.financeSnapshot.findMany({
      where:{locationId},orderBy:{snapshotDate:'desc'},take:365
    });
  }
}
