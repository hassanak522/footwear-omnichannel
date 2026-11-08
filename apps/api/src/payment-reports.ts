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
  if(end<=start||end.getTime()-start.getTime()>32*86400000)throw new BadRequestException('Date range must be 1–31 days');
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
