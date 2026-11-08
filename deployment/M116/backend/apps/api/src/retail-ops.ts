import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Db } from './db';
import { CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

@Controller('retail-ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class RetailOpsController {
  constructor(private readonly db: Db) {}
  private allowed(u: Principal, locationId: string) {
    if (!u.roles.includes('SUPER_ADMIN') && !u.locations.includes(locationId))
      throw new BadRequestException('Location not assigned to this manager');
  }
  @Get('locations')
  locations(@CurrentUser() u: Principal) {
    return this.db.location.findMany({
      where: u.roles.includes('SUPER_ADMIN') ? {type:'BRANCH'} : {id:{in:u.locations},type:'BRANCH'},
      select:{id:true,name:true,code:true},orderBy:{name:'asc'}
    });
  }
  @Get('sales')
  async sales(@CurrentUser() u: Principal,@Query('locationId') locationId?:string) {
    if(!locationId) throw new BadRequestException('locationId required');
    this.allowed(u,locationId);
    const rows=await this.db.posSale.findMany({
      where:{locationId},orderBy:{soldAt:'desc'},take:100,
      include:{lines:true,tenders:true,returns:{include:{lines:true}}}
    });
    return rows.map(s=>({
      id:s.id,localSaleId:s.localSaleId,soldAt:s.soldAt,status:s.status,
      total:s.total.toString(),locationId:s.locationId,
      lines:s.lines.map(l=>({variantId:l.variantId,quantity:l.quantity,unitPrice:l.unitPrice.toString(),
        returnedQty:s.returns.flatMap(r=>r.lines).filter(r=>r.variantId===l.variantId).reduce((n,r)=>n+r.quantity,0)})),
      tenders:s.tenders.map(t=>({type:t.type,amount:t.amount.toString()})),
      returns:s.returns.map(r=>({id:r.id,createdAt:r.createdAt,reason:r.reason,
        lines:r.lines.map(l=>({variantId:l.variantId,quantity:l.quantity,quarantined:l.quarantined,refundAmount:l.refundAmount.toString()}))}))
    }));
  }
  @Get('returns')
  async returns(@CurrentUser() u: Principal,@Query('locationId') locationId?:string){
    if(!locationId)throw new BadRequestException('locationId required');
    this.allowed(u,locationId);
    const rows=await this.db.posReturn.findMany({
      where:{locationId},orderBy:{createdAt:'desc'},take:100,include:{lines:true}
    });
    return rows.map(r=>({id:r.id,saleId:r.saleId,reason:r.reason,createdAt:r.createdAt,
      amount:r.lines.reduce((n,l)=>n+l.refundAmount.toNumber(),0).toFixed(2),
      lines:r.lines.map(l=>({variantId:l.variantId,quantity:l.quantity,quarantined:l.quarantined,refundAmount:l.refundAmount.toString()}))}));
  }
  @Get('daily-summary')
  async summary(@CurrentUser() u: Principal,@Query('locationId') locationId?:string,@Query('date') date?:string){
    if(!locationId||!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new BadRequestException('locationId and date YYYY-MM-DD required');
    this.allowed(u,locationId);
    const start=new Date(date+'T00:00:00.000Z');
    if(Number.isNaN(start.getTime())||start.toISOString().slice(0,10)!==date)throw new BadRequestException('Invalid date');
    const end=new Date(start.getTime()+86400000);
    const [sales,returns,shifts]=await Promise.all([
      this.db.posSale.findMany({where:{locationId,status:'ACCEPTED',soldAt:{gte:start,lt:end}},include:{tenders:true}}),
      this.db.posReturn.findMany({where:{locationId,createdAt:{gte:start,lt:end}},include:{lines:true}}),
      this.db.posShift.findMany({where:{locationId,openedAt:{gte:start,lt:end}},select:{id:true,status:true,openingCash:true,closingCash:true}})
    ]);
    const tender=(type:string)=>sales.flatMap(s=>s.tenders).filter(t=>t.type===type).reduce((n,t)=>n+t.amount.toNumber(),0);
    const gross=sales.reduce((n,s)=>n+s.total.toNumber(),0);
    const returned=returns.flatMap(r=>r.lines).reduce((n,l)=>n+l.refundAmount.toNumber(),0);
    return {locationId,date,timezone:'UTC',acceptedSales:sales.length,returns:returns.length,
      grossSales:gross.toFixed(2),approvedReturnValue:returned.toFixed(2),
      netAfterApprovedReturns:(gross-returned).toFixed(2),
      cashTender:tender('CASH').toFixed(2),cardTender:tender('CARD').toFixed(2),
      shifts:shifts.map(s=>({id:s.id,status:s.status,openingCash:s.openingCash.toString(),closingCash:s.closingCash?.toString()??null})),
      note:'Return value is approved merchandise value; this does not confirm a cash or gateway refund was paid.'};
  }
}
