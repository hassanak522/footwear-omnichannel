import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsEnum, IsNumber, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CashReconciliationStatus, Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class SubmitCashDto {
 @IsUUID() shiftId!:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) countedCash!:number;
 @IsString() @MaxLength(1000) note!:string;
}
class ReviewCashDto {
 @IsEnum(CashReconciliationStatus) status!:CashReconciliationStatus;
 @IsString() @MaxLength(2000) note!:string;
}
@Controller('cash-reconciliation')
@UseGuards(JwtAuthGuard,RolesGuard)
export class CashReconciliationController {
 constructor(private readonly db:Db){}
 private isManager(u:Principal){return u.roles.includes('SUPER_ADMIN')||u.roles.includes('BRANCH_MANAGER');}
 private async getAccessible(id:string,u:Principal){
  const rec=await this.db.cashReconciliation.findUniqueOrThrow({where:{id}});
  assertLocation(u,rec.locationId);
  if(!this.isManager(u)&&rec.submittedById!==u.id)throw new ForbiddenException('Only your own reconciliation is accessible');
  return rec;
 }
  @Post('submit') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
  async submit(@Body() d:SubmitCashDto,@CurrentUser() u:Principal){
    const shift=await this.db.posShift.findUniqueOrThrow({where:{id:d.shiftId}});
    assertLocation(u,shift.locationId);
    if(shift.status!=='CLOSED')throw new ConflictException('Close the POS shift before reconciliation');
    if(!this.isManager(u)&&shift.cashierId!==u.id)throw new ForbiddenException('Only the shift cashier may submit');
    const snapshot=await this.db.posShiftClosingSnapshot.findUnique({where:{shiftId:d.shiftId}});
    if(!snapshot)throw new ConflictException('Closed legacy shift has no verified closing snapshot; manual review required');
    const countedCents=Math.round(d.countedCash*100);
    const snapshotCountedCents=Math.round(snapshot.countedCash.toNumber()*100);
    if(countedCents!==snapshotCountedCents)throw new ConflictException('Reconciliation counted cash must equal the shift closing snapshot; record a separate recount discrepancy');
    try{
      return await this.db.cashReconciliation.create({data:{
        shiftId:shift.id,locationId:shift.locationId,
        openingCash:snapshot.openingCash,recordedCashSales:snapshot.cashSales,
        expectedCash:snapshot.expectedCash,countedCash:snapshot.countedCash,variance:snapshot.variance,
        cashierNote:d.note.trim(),submittedById:u.id
      }});
    }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('Reconciliation already submitted for this shift');throw e;}
  }
 @Get() @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async list(@Query('locationId') locationId:string,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');
  assertLocation(u,locationId);
  return this.db.cashReconciliation.findMany({where:{locationId,...(!this.isManager(u)?{submittedById:u.id}:{})},orderBy:{submittedAt:'desc'},take:100});
 }
 @Get(':id') @Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
 async detail(@Param('id') id:string,@CurrentUser() u:Principal){return this.getAccessible(id,u);}
 @Patch(':id/review') @Roles('SUPER_ADMIN','BRANCH_MANAGER')
 async review(@Param('id') id:string,@Body() d:ReviewCashDto,@CurrentUser() u:Principal){
  if(!this.isManager(u))throw new ForbiddenException('Manager required');
  const rec=await this.getAccessible(id,u);
  if(rec.status!=='SUBMITTED')throw new ConflictException('Already reviewed');
  if(d.status!=='APPROVED'&&d.status!=='DISPUTED')throw new BadRequestException('Review must APPROVE or DISPUTE');
  if(!d.note.trim())throw new BadRequestException('Review note required');
  const result=await this.db.cashReconciliation.updateMany({where:{id,status:'SUBMITTED'},data:{status:d.status,reviewedById:u.id,reviewedAt:new Date(),reviewNote:d.note.trim()}});
  if(result.count!==1)throw new ConflictException('Reconciliation changed; reload');
  return this.db.cashReconciliation.findUniqueOrThrow({where:{id}});
 }
}
