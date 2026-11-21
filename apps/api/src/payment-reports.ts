import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('payment-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class PaymentReportsController {
 constructor(private readonly db:Db){}
 private range(u:Principal,locationId:string,from:string,to:string){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  const valid=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  if(!valid(from)||!valid(to))throw new BadRequestException('from and to must be valid YYYY-MM-DD');
  const start=new Date(from+'T00:00:00.000Z');
  const end=new Date(new Date(to+'T00:00:00.000Z').getTime()+86400000);
  if(end<=start||end.getTime()-start.getTime()>32*86400000)throw new BadRequestException('Date range must be 1â€“31 days');
  return {start,end};
 }
 @Get('summary')
 async summary(@CurrentUser() u:Principal,@Query('locationId') locationId:string,@Query('from') from:string,@Query('to') to:string){
  const {start,end}=this.range(u,locationId,from,to);
  const [sales,returns,cases,shifts]=await Promise.all([
   this.db.posSale.findMany({where:{locationId,status:'ACCEPTED',soldAt:{gte:start,lt:end}},select:{id:true,total:true,tenders:{select:{type:true,amount:true}}}}),
   this.db.posReturn.findMany({where:{locationId,createdAt:{gte:start,lt:end}},select:{lines:{select:{refundAmount:true}}}}),
   this.db.paymentException.findMany({where:{locationId,createdAt:{gte:start,lt:end}},select:{status:true,expectedAmount:true,observedAmount:true}}),
   this.db.posShift.findMany({where:{locationId,openedAt:{gte:start,lt:end}},select:{status:true,openingCash:true,closingCash:true}})
  ]);
  const cents=(x:{toNumber:()=>number})=>Math.round(x.toNumber()*100);
  const money=(v:number)=>(v/100).toFixed(2);
  const tender=(type:string)=>sales.flatMap(s=>s.tenders).filter(t=>t.type===type).reduce((n,t)=>n+cents(t.amount),0);
  const total=sales.reduce((n,s)=>n+cents(s.total),0);
  const returned=returns.flatMap(r=>r.lines).reduce((n,l)=>n+cents(l.refundAmount),0);
  const counts={OPEN:0,UNDER_REVIEW:0,RESOLVED:0,VOIDED:0};
  for(const c of cases)counts[c.status]++;
  return {locationId,from,to,timezone:'UTC',acceptedSales:sales.length,recordedTenderTotal:money(tender('CASH')+tender('CARD')),
   cashTender:money(tender('CASH')),cardTender:money(tender('CARD')),saleTotal:money(total),approvedReturnValue:money(returned),
   merchandiseNetAfterReturns:money(total-returned),saleTenderDifference:money(total-tender('CASH')-tender('CARD')),
   exceptions:counts,exceptionCount:cases.length,shiftsOpened:shifts.length,shiftsClosed:shifts.filter(s=>s.status==='CLOSED').length,
   note:'Tender amounts are POS records, NOT confirmed deposits, card settlements or cash received. Return values are merchandise authorizations, NOT proven disbursements. Exception status is administrative.'};
 }
 // R8_01G_4B12_CLEARANCE_FINANCE
 @Get('clearance')
 async clearance(
  @CurrentUser() u:Principal,
  @Query('locationId') locationId:string,
  @Query('from') from:string,
  @Query('to') to:string
 ){
  const {start,end}=this.range(u,locationId,from,to);

  const [sales,attempts]=await Promise.all([
   this.db.posSale.findMany({
    where:{
     locationId,
     status:'ACCEPTED',
     soldAt:{gte:start,lt:end},
     clearanceAllocations:{some:{}}
    },
    select:{
     id:true,
     deviceId:true,
     localSaleId:true,
     shiftId:true,
     soldAt:true,
     total:true,
     tenders:{
      select:{type:true,amount:true}
     },
     clearanceAllocations:{
      select:{
       grossAmount:true,
       discountAmount:true,
       netAmount:true
      }
     }
    },
    orderBy:{soldAt:'desc'},
    take:1000
   }),
   this.db.posClearanceAttempt.findMany({
    where:{
     locationId,
     createdAt:{gte:start,lt:end}
    },
    select:{
     id:true,
     deviceId:true,
     localSaleId:true,
     shiftId:true,
     status:true,
     createdAt:true,
     updatedAt:true
    },
    orderBy:{createdAt:'desc'},
    take:1000
   })
  ]);

  const cents=(value:{toNumber:()=>number})=>
   Math.round(value.toNumber()*100);

  const money=(value:number)=>
   (value/100).toFixed(2);

  let gross=0;
  let discount=0;
  let allocationNet=0;
  let saleTotal=0;
  let cash=0;
  let card=0;
  let otherTender=0;

  const rows=sales.map(sale=>{
   const allocatedGross=sale.clearanceAllocations.reduce(
    (sum,a)=>sum+cents(a.grossAmount),0
   );

   const allocatedDiscount=sale.clearanceAllocations.reduce(
    (sum,a)=>sum+cents(a.discountAmount),0
   );

   const allocatedNet=sale.clearanceAllocations.reduce(
    (sum,a)=>sum+cents(a.netAmount),0
   );

   const recordedCash=sale.tenders
    .filter(t=>t.type==='CASH')
    .reduce((sum,t)=>sum+cents(t.amount),0);

   const recordedCard=sale.tenders
    .filter(t=>t.type==='CARD')
    .reduce((sum,t)=>sum+cents(t.amount),0);

   const recordedOther=sale.tenders
    .filter(t=>t.type!=='CASH'&&t.type!=='CARD')
    .reduce((sum,t)=>sum+cents(t.amount),0);

   const total=cents(sale.total);

   gross+=allocatedGross;
   discount+=allocatedDiscount;
   allocationNet+=allocatedNet;
   saleTotal+=total;
   cash+=recordedCash;
   card+=recordedCard;
   otherTender+=recordedOther;

   return {
    saleId:sale.id,
    deviceId:sale.deviceId,
    localSaleId:sale.localSaleId,
    shiftId:sale.shiftId,
    soldAt:sale.soldAt,
    saleTotal:money(total),
    allocatedGross:money(allocatedGross),
    allocatedDiscount:money(allocatedDiscount),
    allocatedNet:money(allocatedNet),
    cashTender:money(recordedCash),
    cardTender:money(recordedCard),
    otherTender:money(recordedOther),
    allocationMatchesSale:allocatedNet===total,
    tenderMatchesSale:
     recordedCash+recordedCard+recordedOther===total
   };
  });

  const statusCounts={
   REGISTERED:0,
   REVIEW_REQUIRED:0,
   ACCEPTED:0,
   RESOLVED_NO_SALE:0,
   OTHER:0
  };

  for(const attempt of attempts){
   const status=attempt.status as keyof typeof statusCounts;
   if(status in statusCounts)statusCounts[status]++;
   else statusCounts.OTHER++;
  }

  const unresolved=attempts.filter(a=>
   a.status==='REGISTERED'||
   a.status==='REVIEW_REQUIRED'
  );

  const noSale=attempts.filter(a=>
   a.status==='RESOLVED_NO_SALE'
  );

  return {
   locationId,
   from,
   to,
   timezone:'UTC',
   readOnly:true,
   truncated:sales.length===1000||attempts.length===1000,
   summary:{
    acceptedClearanceSales:sales.length,
    grossAllocationValue:money(gross),
    clearanceDiscount:money(discount),
    allocationNet:money(allocationNet),
    acceptedSaleTotal:money(saleTotal),
    recordedCashTender:money(cash),
    recordedCardTender:money(card),
    recordedOtherTender:money(otherTender),
    recordedTenderTotal:money(cash+card+otherTender),
    allocationDifference:money(saleTotal-allocationNet),
    tenderDifference:money(saleTotal-cash-card-otherTender),
    allocationMismatchCount:
     rows.filter(r=>!r.allocationMatchesSale).length,
    tenderMismatchCount:
     rows.filter(r=>!r.tenderMatchesSale).length,
    unresolvedAttemptCount:unresolved.length,
    resolvedNoSaleCount:noSale.length,
    attemptStatusCounts:statusCounts
   },
   sales:rows,
   unresolvedAttempts:unresolved,
   resolvedNoSaleAttempts:noSale,
   note:
    'Recorded POS tenders are not verified bank settlements '+
    'or cash deposits. No-sale resolution is an administrative '+
    'attestation, not independent proof of payment settlement. '+
    'Reports are limited to 1000 sales and 1000 attempts; '+
    'truncated results must not be treated as complete totals.'
  };
 }
 @Get('audit')
 async audit(@CurrentUser() u:Principal,@Query('locationId') locationId:string,@Query('from') from:string,@Query('to') to:string){
  const {start,end}=this.range(u,locationId,from,to);
  const cases=await this.db.paymentException.findMany({where:{locationId,createdAt:{gte:start,lt:end}},
   orderBy:[{createdAt:'asc'},{id:'asc'}],take:1000,
   select:{id:true,deviceId:true,localSaleId:true,saleId:true,status:true,reason:true,expectedAmount:true,observedAmount:true,reportedById:true,reviewedById:true,reviewNote:true,createdAt:true,updatedAt:true,resolvedAt:true,
    evidences: {
      orderBy: { createdAt: 'asc' },
      select: {
        kind: true,
        reference: true,
        note: true,
        createdById: true,
        createdAt: true
      }
}}});
  return {locationId,from,to,timezone:'UTC',truncated:cases.length===1000,rows:cases.map(c=>({...c,
   expectedAmount:c.expectedAmount?.toString()??null,observedAmount:c.observedAmount?.toString()??null,
   evidenceCount:c.evidences.length}))};
 }
}
