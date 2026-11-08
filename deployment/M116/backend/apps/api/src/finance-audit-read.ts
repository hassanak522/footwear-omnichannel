import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('finance-audit-read')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceAuditReadController {
  constructor(private readonly db:Db) {}

  @Get('location-events')
  async events(@Query('locationId') locationId:string,@CurrentUser() user:Principal){
    if(!locationId)throw new BadRequestException('locationId required');
    assertLocation(user,locationId);
    const [payments,postings,costs,locks]=await Promise.all([
      this.db.supplierPaymentRequest.findMany({where:{warehouseId:locationId},
        orderBy:{createdAt:'desc'},take:100,
        select:{id:true,invoiceId:true,status:true,amount:true,requestedById:true,
          reviewedById:true,reviewedAt:true,createdAt:true}}),
      this.db.financePostingBatch.findMany({where:{locationId},
        orderBy:{createdAt:'desc'},take:100,
        select:{id:true,sourceType:true,sourceId:true,status:true,createdById:true,createdAt:true}}),
      this.db.inventoryCostRevision.findMany({where:{locationId},
        orderBy:{createdAt:'desc'},take:100,
        select:{id:true,variantId:true,previousCost:true,newCost:true,reason:true,actorId:true,createdAt:true}}),
      this.db.financePeriodLock.findMany({where:{locationId},
        orderBy:{lockedAt:'desc'},take:100,
        select:{id:true,periodStart:true,periodEnd:true,reason:true,lockedById:true,lockedAt:true}})
    ]);
    const events=[
      ...payments.map(x=>({type:'PAYMENT_REQUEST',at:x.createdAt,record:x})),
      ...postings.map(x=>({type:'STAGED_POSTING',at:x.createdAt,record:x})),
      ...costs.map(x=>({type:'COST_REVISION',at:x.createdAt,record:x})),
      ...locks.map(x=>({type:'PERIOD_LOCK',at:x.lockedAt,record:x}))
    ].sort((a,b)=>b.at.getTime()-a.at.getTime());
    return {locationId,events,limits:{perCategory:100},
      warning:'Derived operational activity view, not an immutable comprehensive audit log. Legacy records and deleted events may be absent.'};
  }
}
