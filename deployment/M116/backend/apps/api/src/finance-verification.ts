import { BadRequestException, ConflictException, Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Prisma, SettlementReviewDecision } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-verification')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceVerificationController {
  constructor(private readonly db:Db) {}

  // M63: independent review; this is documentary verification, not a bank API confirmation.
  @Post('settlements/:settlementId/review')
  async review(@Param('settlementId') settlementId:string,
    @Body() body:{decision:string;evidenceReference:string;note:string},
    @CurrentUser() user:Principal){
    if(!['VERIFIED','DISPUTED'].includes(body.decision) ||
      !body.evidenceReference?.trim() || !body.note?.trim() ||
      body.evidenceReference.length>200 || body.note.length>1000)
      throw new BadRequestException('Valid decision, evidence reference and note required');
    const settlement=await this.db.supplierPaymentSettlement.findUnique({where:{id:settlementId}});
    if(!settlement)throw new BadRequestException('Settlement evidence not found');
    assertLocation(user,settlement.warehouseId);
    if(settlement.recordedById===user.id)
      throw new ConflictException('Settlement recorder cannot review their own evidence');
    const lock=await this.db.financePeriodLock.findFirst({where:{
      locationId:settlement.warehouseId,
      periodStart:{lte:settlement.settledAt},periodEnd:{gt:settlement.settledAt}
    }});
    if(lock)throw new ConflictException('Settlement date is within a locked period');
    try{
      return await this.db.supplierSettlementReview.create({data:{
        settlementId:settlement.id,warehouseId:settlement.warehouseId,
        decision:body.decision as SettlementReviewDecision,
        evidenceReference:body.evidenceReference.trim(),note:body.note.trim(),
        reviewerId:user.id
      }});
    }catch(e){
      if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')
        throw new ConflictException('Settlement already reviewed');
      throw e;
    }
  }

  @Get('settlements')
  async settlements(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    const [settlements,reviews]=await Promise.all([
      this.db.supplierPaymentSettlement.findMany({
        where:{warehouseId:locationId},orderBy:{createdAt:'desc'},take:500
      }),
      this.db.supplierSettlementReview.findMany({
        where:{warehouseId:locationId},orderBy:{reviewedAt:'desc'},take:500
      })
    ]);
    const bySettlement=new Map(reviews.map(r=>[r.settlementId,r]));
    return {locationId,rows:settlements.map(s=>({
      ...s,review:bySettlement.get(s.id)??null
    })),truncated:settlements.length===500,
    warning:'VERIFIED means an authorized staff member reviewed evidence, not bank-verified settlement.'};
  }

  // M65: reconciliation rows, consumable as CSV by the HQ UI.
  @Get('reconciliation-rows')
  async reconciliationRows(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    const invoices=await this.db.supplierInvoice.findMany({
      where:{warehouseId:locationId},orderBy:{createdAt:'desc'},take:500
    });
    const ids=invoices.map(x=>x.id);
    const settlements=ids.length?await this.db.supplierPaymentSettlement.findMany({
      where:{invoiceId:{in:ids}},take:5000
    }):[];
    const reviews=settlements.length?await this.db.supplierSettlementReview.findMany({
      where:{settlementId:{in:settlements.map(x=>x.id)}},take:5000
    }):[];
    const reviewMap=new Map(reviews.map(x=>[x.settlementId,x.decision]));
    const sums=new Map<string,{verified:Prisma.Decimal;disputed:Prisma.Decimal;unreviewed:Prisma.Decimal}>();
    for(const s of settlements){
      const sum=sums.get(s.invoiceId)??{
        verified:new Prisma.Decimal(0),disputed:new Prisma.Decimal(0),unreviewed:new Prisma.Decimal(0)
      };
      const decision=reviewMap.get(s.id);
      if(decision==='VERIFIED')sum.verified=sum.verified.plus(s.amount);
      else if(decision==='DISPUTED')sum.disputed=sum.disputed.plus(s.amount);
      else sum.unreviewed=sum.unreviewed.plus(s.amount);
      sums.set(s.invoiceId,sum);
    }
    return {locationId,truncated:invoices.length===500||settlements.length===5000,
      rows:invoices.map(inv=>{
        const sum=sums.get(inv.id)??{verified:new Prisma.Decimal(0),disputed:new Prisma.Decimal(0),unreviewed:new Prisma.Decimal(0)};
        return {invoiceId:inv.id,invoiceNumber:inv.invoiceNumber,
          invoiceDate:inv.invoiceDate.toISOString(),invoiceAmount:inv.totalAmount.toString(),
          verifiedEvidence:sum.verified.toString(),disputedEvidence:sum.disputed.toString(),
          unreviewedEvidence:sum.unreviewed.toString(),
          remainingAgainstVerifiedEvidence:inv.totalAmount.minus(sum.verified).toString()};
      }),
      warning:'Staff-reviewed evidence, not independently bank-verified. Excludes invoices beyond the row limit.'};
  }
}
