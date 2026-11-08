import { BadRequestException, ConflictException, Controller, Get, Param, Post, Body, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-guardrails')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceGuardrailsController {
  constructor(private readonly db:Db) {}

  // M54: controlled payment request endpoint. Legacy payment-request routes remain unaffected.
  @Post('controlled-payment-request')
  async controlledPayment(@Body() body:{
    invoiceId:string; amount:number; reference:string; idempotencyKey:string; note:string
  },@CurrentUser() user:Principal) {
    if(!body.invoiceId||!Number.isFinite(body.amount)||body.amount<=0||
      !body.reference?.trim()||!body.idempotencyKey?.trim()||!body.note?.trim())
      throw new BadRequestException('Invoice, positive amount, reference, idempotency key and note required');
    const amount=new Prisma.Decimal(body.amount.toFixed(2));
    if(amount.lte(0))throw new BadRequestException('Amount must be at least 0.01');
    try {
      return await this.db.$transaction(async tx=>{
        // Lock invoice row to serialize aggregate-cap checks for this endpoint.
        await tx.$queryRaw`SELECT id FROM "SupplierInvoice" WHERE id = ${body.invoiceId}::uuid FOR UPDATE`;
        const invoice=await tx.supplierInvoice.findUnique({where:{id:body.invoiceId}});
        if(!invoice)throw new BadRequestException('Invoice not found');
        assertLocation(user,invoice.warehouseId);
        if(invoice.status!=='REVIEWED')throw new BadRequestException('Invoice must be reviewed');
        const existing=await tx.supplierPaymentRequest.aggregate({
          where:{invoiceId:invoice.id,status:{in:['PENDING','APPROVED']}},_sum:{amount:true}
        });
        const reserved=existing._sum.amount??new Prisma.Decimal(0);
        if(reserved.plus(amount).gt(invoice.totalAmount))
          throw new ConflictException('Pending and approved requests exceed invoice total');
        return tx.supplierPaymentRequest.create({data:{
          invoiceId:invoice.id,warehouseId:invoice.warehouseId,amount,
          reference:body.reference.trim(),idempotencyKey:body.idempotencyKey.trim(),
          note:body.note.trim(),requestedById:user.id
        }});
      },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    }catch(e){
      if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')
        throw new ConflictException('Duplicate payment request');
      throw e;
    }
  }

  // M55: lock a calendar period; overlapping periods prohibited by transaction + location lock.
  @Post('period-locks')
  async lockPeriod(@Body() body:{locationId:string;periodStart:string;periodEnd:string;reason:string},
    @CurrentUser() user:Principal) {
    if(!body.locationId||!body.reason?.trim())throw new BadRequestException('Location and reason required');
    assertLocation(user,body.locationId);
    const start=new Date(body.periodStart),end=new Date(body.periodEnd);
    if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||start>=end)
      throw new BadRequestException('Valid periodStart < periodEnd required');
    try{
      return await this.db.$transaction(async tx=>{
        // PostgreSQL advisory lock scoped to the location prevents concurrent overlapping inserts here.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${body.locationId}))`;
        const overlap=await tx.financePeriodLock.findFirst({where:{
          locationId:body.locationId,periodStart:{lt:end},periodEnd:{gt:start}
        }});
        if(overlap)throw new ConflictException('Period overlaps existing lock');
        return tx.financePeriodLock.create({data:{
          locationId:body.locationId,periodStart:start,periodEnd:end,
          reason:body.reason.trim(),lockedById:user.id
        }});
      });
    }catch(e){
      if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')
        throw new ConflictException('Period lock already exists');
      throw e;
    }
  }

  @Get('period-locks')
  async periodLocks(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    return this.db.financePeriodLock.findMany({
      where:{locationId},orderBy:{periodStart:'desc'},take:100
    });
  }

  // M56: aligned date rollup; snapshots are manually supplied, not audited.
  @Get('hq-period-report')
  async report(@Query('locationIds') locationIds:string,@Query('snapshotDate') snapshotDate:string,
    @CurrentUser() user:Principal){
    const ids=[...new Set((locationIds||'').split(',').map(s=>s.trim()).filter(Boolean))];
    if(!ids.length||ids.length>25||ids.some(id=>!/^[0-9a-fA-F-]{36}$/.test(id)))
      throw new BadRequestException('Provide 1–25 location UUIDs');
    ids.forEach(id=>assertLocation(user,id));
    const date=new Date(snapshotDate);
    if(!snapshotDate||Number.isNaN(date.getTime()))
      throw new BadRequestException('Valid snapshotDate required');
    const rows=await this.db.financeSnapshot.findMany({
      where:{locationId:{in:ids},snapshotDate:date},take:26
    });
    const keys=['cashSales','receivables','payables','estimatedStockValue'] as const;
    const totals={} as Record<string,string>;
    for(const key of keys)totals[key]=rows.reduce(
      (sum,row)=>sum.plus(row[key]),new Prisma.Decimal(0)
    ).toString();
    const present=new Set(rows.map(r=>r.locationId));
    return {snapshotDate:date.toISOString(),currency:'PKR',
      requestedLocations:ids.length,reportedLocations:rows.length,
      missingLocationIds:ids.filter(id=>!present.has(id)),totals,rows,
      complete:rows.length===ids.length,
      warning:'Management-entered snapshot totals only. No intercompany eliminations, ledger verification or audited P&L.'};
  }
}
