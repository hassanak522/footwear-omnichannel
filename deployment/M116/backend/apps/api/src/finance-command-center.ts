import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-command-center')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceCommandCenterController {
  constructor(private readonly db:Db){}

  private scope(locationId:string,user:Principal){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId||''))
      throw new BadRequestException('Valid locationId UUID required');
    assertLocation(user,locationId);
  }
  private dates(from:string,to:string){
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(from||'')||!/^\\d{4}-\\d{2}-\\d{2}$/.test(to||''))
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    const start=new Date(from+'T00:00:00.000Z'),end=new Date(to+'T00:00:00.000Z');
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end||
      end.getTime()-start.getTime()>366*86400000)
      throw new BadRequestException('Invalid date range or exceeds 366 days');
    return {gte:start,lt:new Date(end.getTime()+86400000)};
  }

  // M75: aged alert feed. On-demand only; no scheduler/email/push delivery.
  @Get('alert-feed')
  async alertFeed(@Query('locationId') locationId:string,@Query('olderThanDays') daysRaw:string,
    @CurrentUser() user:Principal){
    this.scope(locationId,user);
    const days=daysRaw===undefined?7:Number(daysRaw);
    if(!Number.isInteger(days)||days<1||days>365)
      throw new BadRequestException('olderThanDays must be 1–365');
    const cutoff=new Date(Date.now()-days*86400000);
    const [cases,settlements,reviews]=await Promise.all([
      this.db.financeExceptionCase.findMany({
        where:{locationId,status:{in:['OPEN','INVESTIGATING']},createdAt:{lte:cutoff}},
        orderBy:{createdAt:'asc'},take:500
      }),
      this.db.supplierPaymentSettlement.findMany({
        where:{warehouseId:locationId,createdAt:{lte:cutoff}},
        orderBy:{createdAt:'asc'},take:500
      }),
      this.db.supplierSettlementReview.findMany({where:{warehouseId:locationId},take:5000})
    ]);
    const reviewed=new Set(reviews.map(r=>r.settlementId));
    const alerts=[
      ...cases.map(c=>({type:'AGED_OPEN_CASE',id:c.id,invoiceId:null,
        createdAt:c.createdAt,summary:c.summary})),
      ...settlements.filter(s=>!reviewed.has(s.id)).map(s=>({
        type:'AGED_UNREVIEWED_SETTLEMENT',id:s.id,invoiceId:s.invoiceId,
        createdAt:s.createdAt,summary:'Settlement evidence awaiting independent review'
      }))
    ].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime());
    return {locationId,olderThanDays:days,alerts,
      truncated:cases.length===500||settlements.length===500||reviews.length===5000,
      warning:'On-demand age-based alert feed. No scheduled execution, email, push, or delivery guarantees.'};
  }

  // M76: date-filtered invoice register; no verified supplier relation assumed.
  @Get('invoice-statement-range')
  async statement(@Query('locationId') locationId:string,
    @Query('from') from:string,@Query('to') to:string,@CurrentUser() user:Principal){
    this.scope(locationId,user);
    const range=this.dates(from,to);
    const invoices=await this.db.supplierInvoice.findMany({
      where:{warehouseId:locationId,invoiceDate:range},
      orderBy:{invoiceDate:'desc'},take:500
    });
    const settlements=invoices.length?await this.db.supplierPaymentSettlement.findMany({
      where:{invoiceId:{in:invoices.map(i=>i.id)}},take:5000
    }):[];
    const reviews=settlements.length?await this.db.supplierSettlementReview.findMany({
      where:{settlementId:{in:settlements.map(s=>s.id)}},take:5000
    }):[];
    const reviewed=new Set(reviews.filter(r=>r.decision==='VERIFIED').map(r=>r.settlementId));
    const disputed=new Set(reviews.filter(r=>r.decision==='DISPUTED').map(r=>r.settlementId));
    const rows=invoices.map(i=>{
      const own=settlements.filter(s=>s.invoiceId===i.id);
      const sum=(xs:typeof own)=>xs.reduce((a,s)=>a.plus(s.amount),new Prisma.Decimal(0));
      const verified=sum(own.filter(s=>reviewed.has(s.id)));
      return {invoiceId:i.id,invoiceNumber:i.invoiceNumber,
        invoiceDate:i.invoiceDate.toISOString(),invoiceAmount:i.totalAmount.toString(),
        staffReviewedEvidence:verified.toString(),
        disputedEvidence:sum(own.filter(s=>disputed.has(s.id))).toString(),
        unreviewedEvidence:sum(own.filter(s=>!reviewed.has(s.id)&&!disputed.has(s.id))).toString(),
        remainingAgainstReviewedEvidence:i.totalAmount.minus(verified).toString()};
    });
    return {locationId,from,to,rows,
      truncated:invoices.length===500||settlements.length===5000||reviews.length===5000,
      warning:'Invoice-date range only. Evidence may be entered outside the range. Not supplier-wide or bank-confirmed.'};
  }

  // M77: single API to navigate casework + alerts; read-only operational overview.
  @Get('workflow')
  async workflow(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    this.scope(locationId,user);
    const [cases,pending,locks]=await Promise.all([
      this.db.financeExceptionCase.findMany({
        where:{locationId,status:{in:['OPEN','INVESTIGATING']}},
        orderBy:{createdAt:'asc'},take:100
      }),
      this.db.supplierPaymentRequest.count({
        where:{warehouseId:locationId,status:'PENDING'}
      }),
      this.db.financePeriodLock.findMany({
        where:{locationId},orderBy:{periodStart:'desc'},take:20
      })
    ]);
    return {locationId,openCases:cases,pendingPaymentRequestCount:pending,
      recentPeriodLocks:locks,truncated:cases.length===100||locks.length===20,
      links:{casework:'/admin/finance-casework',reconciliation:'/admin/finance-reconciliation',
        operations:'/admin/finance-operations'},
      warning:'Read-only workflow navigation; case changes remain in the existing casework module.'};
  }
}
