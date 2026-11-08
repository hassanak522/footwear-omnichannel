import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import { assertLocation, CurrentUser, JwtAuthGuard, Principal, Roles, RolesGuard } from './auth';

class JournalLineDto {
 @IsString() @MaxLength(32) accountCode!:string;
 @IsOptional() @IsString() @MaxLength(300) description?:string;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) debit!:number;
 @IsNumber({maxDecimalPlaces:2}) @Min(0) credit!:number;
}
class JournalDto {
 @IsUUID() locationId!:string;
 @IsString() @MaxLength(160) externalKey!:string;
 @IsString() @MaxLength(1000) description!:string;
 @IsString() @MaxLength(60) sourceType!:string;
 @IsOptional() @IsString() @MaxLength(160) sourceId?:string;
 @IsArray() @ArrayMinSize(2) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>JournalLineDto) lines!:JournalLineDto[];
}
class ReverseDto { @IsString() @MaxLength(1000) reason!:string; }
const cents=(n:number)=>Math.round(n*100);
const money=(n:number)=>(n/100).toFixed(2);
const range=(from:string,to:string)=>{
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to))throw new BadRequestException('Valid YYYY-MM-DD UTC dates required');
 const start=new Date(from+'T00:00:00Z'),end=new Date(new Date(to+'T00:00:00Z').getTime()+86400000);
 if(end<=start||end.getTime()-start.getTime()>32*86400000)throw new BadRequestException('Date range must be 1 to 31 days');
 return {gte:start,lt:end};
};
@Controller('finance-management') @UseGuards(JwtAuthGuard,RolesGuard) @Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class FinanceManagementController {
 constructor(private readonly db:Db){}
 @Post('journals')
 async post(@Body() d:JournalDto,@CurrentUser() u:Principal){
  assertLocation(u,d.locationId);
  if(!d.externalKey.trim()||!d.description.trim()||!d.sourceType.trim())throw new BadRequestException('Journal identifiers and description required');
  const lines=d.lines.map(l=>({...l,accountCode:l.accountCode.trim(),description:l.description?.trim()||null}));
  if(lines.some(l=>!l.accountCode||!Number.isSafeInteger(cents(l.debit))||!Number.isSafeInteger(cents(l.credit))||
    (cents(l.debit)===0&&cents(l.credit)===0)||(cents(l.debit)>0&&cents(l.credit)>0)))throw new BadRequestException('Each journal line must have either a positive debit or positive credit');
  const debit=lines.reduce((n,l)=>n+cents(l.debit),0),credit=lines.reduce((n,l)=>n+cents(l.credit),0);
  if(debit!==credit||debit===0)throw new BadRequestException('Journal debits and credits must balance and be nonzero');
  try{return await this.db.financeJournal.create({data:{locationId:d.locationId,externalKey:d.externalKey.trim(),description:d.description.trim(),sourceType:d.sourceType.trim(),sourceId:d.sourceId?.trim()||null,createdById:u.id,
    lines:{create:lines.map(l=>({accountCode:l.accountCode,description:l.description,debit:new Prisma.Decimal(l.debit.toFixed(2)),credit:new Prisma.Decimal(l.credit.toFixed(2))}))}},include:{lines:true}});
  }catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')throw new ConflictException('Duplicate journal external key');throw e;}
 }
 @Get('journals')
 async journals(@Query('locationId') locationId:string,@CurrentUser() u:Principal){if(!locationId)throw new BadRequestException('locationId required');assertLocation(u,locationId);
  return this.db.financeJournal.findMany({where:{locationId},orderBy:{createdAt:'desc'},take:200,include:{lines:true}});}
 @Post('journals/:id/reverse')
 async reverse(@Param('id') id:string,@Body() d:ReverseDto,@CurrentUser() u:Principal){
  if(!d.reason.trim())throw new BadRequestException('Reason required');
  const j=await this.db.financeJournal.findUniqueOrThrow({where:{id}});assertLocation(u,j.locationId);
  const result=await this.db.financeJournal.updateMany({where:{id,status:'POSTED'},data:{status:'REVERSED',reversedById:u.id,reversedAt:new Date(),reversalReason:d.reason.trim()}});
  if(result.count!==1)throw new ConflictException('Journal already reversed');
  return this.db.financeJournal.findUniqueOrThrow({where:{id}});
 }
 @Get('dashboard')
 async dashboard(@Query('locationId') locationId:string,@Query('from') from:string,@Query('to') to:string,@CurrentUser() u:Principal){
  if(!locationId)throw new BadRequestException('locationId required');assertLocation(u,locationId);
  const dates=range(from,to);
  const [movements,settlements,exceptions,journals]=await Promise.all([
   this.db.drawerMovement.findMany({where:{locationId,createdAt:dates},select:{type:true,status:true,amount:true}}),
   this.db.settlementBatch.findMany({where:{locationId,statementDate:dates},select:{entries:{select:{status:true,grossAmount:true,netAmount:true,feeAmount:true}}}}),
   this.db.paymentException.findMany({where:{locationId,createdAt:dates},select:{status:true}}),
   this.db.financeJournal.findMany({where:{locationId,createdAt:dates},select:{status:true,lines:{select:{accountCode:true,debit:true,credit:true}}}})
  ]);
  const movementCounts:Record<string,number>={},exceptionCounts:Record<string,number>={},matchCounts:Record<string,number>={};
  let approvedCashAdjustment=0,pendingMovementTotal=0;
  for(const m of movements){movementCounts[m.status]=(movementCounts[m.status]||0)+1;
   if(m.status==='APPROVED')approvedCashAdjustment+=(m.type==='CASH_IN'?1:-1)*cents(m.amount.toNumber());
   if(m.status==='PENDING')pendingMovementTotal+=cents(m.amount.toNumber());}
  for(const e of exceptions)exceptionCounts[e.status]=(exceptionCounts[e.status]||0)+1;
  let reportedGross=0,reportedFees=0,reportedNet=0;
  for(const b of settlements)for(const e of b.entries){matchCounts[e.status]=(matchCounts[e.status]||0)+1;reportedGross+=cents(e.grossAmount.toNumber());reportedFees+=cents(e.feeAmount.toNumber());reportedNet+=cents(e.netAmount.toNumber());}
  const accounts=new Map<string,{debit:number;credit:number}>();
  for(const j of journals)if(j.status==='POSTED')for(const l of j.lines){const a=accounts.get(l.accountCode)||{debit:0,credit:0};a.debit+=cents(l.debit.toNumber());a.credit+=cents(l.credit.toNumber());accounts.set(l.accountCode,a);}
  return {locationId,from,to,timezone:'UTC',movementCounts,approvedCashAdjustment:money(approvedCashAdjustment),pendingMovementTotal:money(pendingMovementTotal),
   exceptionCounts,settlementBatches:settlements.length,matchCounts,statementGross:money(reportedGross),statementFees:money(reportedFees),statementNet:money(reportedNet),
   journals:{posted:journals.filter(j=>j.status==='POSTED').length,reversed:journals.filter(j=>j.status==='REVERSED').length},
   accountBalances:[...accounts.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([accountCode,v])=>({accountCode,debit:money(v.debit),credit:money(v.credit),netDebit:money(v.debit-v.credit)})),
   limitations:'Manual posted journals only; no automatic POS ledger postings. Statement amounts are imported claims, not verified bank settlement. Approved cash adjustments are informational and not a full cash balance.'};
 }
}
