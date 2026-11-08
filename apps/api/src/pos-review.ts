import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Db } from './db';
import { CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';
class ReviewDto {
 @IsIn(['ACKNOWLEDGED','ESCALATED']) decision!: 'ACKNOWLEDGED'|'ESCALATED';
 @IsString() @MinLength(10) reason!: string;
}
@Controller('pos-review') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class PosReviewController {
 constructor(private db:Db){}
 private where(u:Principal){return u.roles.includes('SUPER_ADMIN')?{}:{locationId:{in:u.locations}};}
 @Get('shifts') async shifts(@CurrentUser() u:Principal){
  const rows=await this.db.posShift.findMany({where:this.where(u),orderBy:{openedAt:'desc'},take:100,include:{sales:{select:{id:true,status:true,total:true,tenders:{select:{type:true,amount:true}}}}}});
  return rows.map(s=>{
   const accepted=s.sales.filter(x=>x.status==='ACCEPTED');
   const cash=accepted.flatMap(x=>x.tenders).filter(x=>x.type==='CASH').reduce((n,x)=>n+x.amount.toNumber(),0);
   const expected=s.openingCash.toNumber()+cash;
   return {id:s.id,locationId:s.locationId,cashierId:s.cashierId,status:s.status,openedAt:s.openedAt,closedAt:s.closedAt,openingCash:s.openingCash.toString(),closingCash:s.closingCash?.toString()??null,expectedCash:expected,variance:s.closingCash===null?null:s.closingCash.toNumber()-expected,acceptedSales:accepted.length,conflicts:s.sales.filter(x=>x.status==='STOCK_CONFLICT').length};
  });
 }
 @Get('conflicts') async conflicts(@CurrentUser() u:Principal){return this.db.posSale.findMany({where:{...this.where(u),status:'STOCK_CONFLICT'},orderBy:{syncedAt:'desc'},take:100,select:{id:true,locationId:true,shiftId:true,localSaleId:true,total:true,conflictReason:true,soldAt:true,lines:{select:{variantId:true,quantity:true,unitPrice:true}}}});}
 @Get('reviews') async reviews(@CurrentUser() u:Principal){
  const audits=await this.db.auditLog.findMany({where:{action:{in:['POS_CONFLICT_REVIEW','POS_SHIFT_REVIEW']}},orderBy:{createdAt:'desc'},take:200});
  if(u.roles.includes('SUPER_ADMIN'))return audits;
  const shifts=await this.db.posShift.findMany({where:this.where(u),select:{id:true}});
  const sales=await this.db.posSale.findMany({where:this.where(u),select:{id:true}});
  const allowed=new Set([...shifts.map(x=>x.id),...sales.map(x=>x.id)]);
  return audits.filter(a=>allowed.has(a.entityId));
 }
 @Post('conflicts/:id/review') async reviewConflict(@Param('id') id:string,@Body() dto:ReviewDto,@CurrentUser() u:Principal){
  const sale=await this.db.posSale.findFirst({where:{id,...this.where(u)}});
  if(!sale)throw new BadRequestException('Sale not found or outside assigned branch');
  if(sale.status!=='STOCK_CONFLICT')throw new BadRequestException('Only stock conflicts can be reviewed');
  return this.db.auditLog.create({data:{actorId:u.id,action:'POS_CONFLICT_REVIEW',entityType:'PosSale',entityId:id,after:{decision:dto.decision,reason:dto.reason,locationId:sale.locationId}}});
 }
 @Post('shifts/:id/review') async reviewShift(@Param('id') id:string,@Body() dto:ReviewDto,@CurrentUser() u:Principal){
  const shift=await this.db.posShift.findFirst({where:{id,...this.where(u)}});
  if(!shift)throw new BadRequestException('Shift not found or outside assigned branch');
  return this.db.auditLog.create({data:{actorId:u.id,action:'POS_SHIFT_REVIEW',entityType:'PosShift',entityId:id,after:{decision:dto.decision,reason:dto.reason,locationId:shift.locationId}}});
 }
}
