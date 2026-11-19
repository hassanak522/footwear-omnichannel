import {
 BadRequestException, ConflictException, Controller,
 Get, Post, Body, Param, Query, UseGuards,
 NotFoundException
} from '@nestjs/common';
import {Prisma, UserStatus} from '@prisma/client';
import {Db} from './db';
import {
 assertLocation, CurrentUser, JwtAuthGuard,
 Principal, Roles, RolesGuard
} from './auth';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sourceTypes=['POS_REFUND_SETTLEMENT','POS_SHIFT_CLOSING'];
const caseStatuses=['OPEN','INVESTIGATING','RESOLVED','DISMISSED'];

@Controller('pos/finance/cases')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER')
export class RetailFinanceCaseworkController {
 constructor(private readonly db:Db){}

 private authorize(user:Principal,locationId:string){
  if(!uuid.test(locationId||'')){
   throw new BadRequestException('Valid branch UUID required');
  }
  assertLocation(user,locationId);
 }

 private async sourceExists(
  locationId:string,sourceType:string,sourceId:string
 ){
  if(sourceType==='POS_REFUND_SETTLEMENT'){
   return !!await this.db.posRefundSettlement.findFirst({
    where:{id:sourceId,return:{locationId}},
    select:{id:true}
   });
  }

  if(sourceType==='POS_SHIFT_CLOSING'){
   return !!await this.db.posShiftClosingSnapshot.findFirst({
    where:{shiftId:sourceId,locationId},
    select:{id:true}
   });
  }
  return false;
 }

 private async findCase(id:string,user:Principal){
  if(!uuid.test(id||'')){
   throw new BadRequestException('Invalid case UUID');
  }

  const item=await this.db.financeExceptionCase.findFirst({
   where:{id,sourceType:{in:sourceTypes}}
  });

  if(!item)throw new NotFoundException('Case not found');

  this.authorize(user,item.locationId);
  return item;
 }

 @Get()
 async list(
  @Query('locationId') locationId:string,
  @Query('status') status:string,
  @CurrentUser() user:Principal
 ){
  if(locationId){
   this.authorize(user,locationId);
  }else if(!user.roles.includes('SUPER_ADMIN')){
   throw new BadRequestException('Branch UUID required');
  }

  if(status&&!caseStatuses.includes(status)){
   throw new BadRequestException('Invalid case status');
  }

  const where:Prisma.FinanceExceptionCaseWhereInput={
   sourceType:{in:sourceTypes},
   ...(locationId?{locationId}:{}),
   ...(status?{status:status as any}:{})
  };

  const [total,rows]=await Promise.all([
   this.db.financeExceptionCase.count({where}),
   this.db.financeExceptionCase.findMany({
    where,orderBy:{updatedAt:'desc'},take:100
   })
  ]);

  return {total,rows,truncated:total>rows.length};
 }

 @Get(':id')
 async detail(
  @Param('id') id:string,
  @CurrentUser() user:Principal
 ){
  const item=await this.findCase(id,user);
  const events=await this.db.financeExceptionCaseEvent.findMany({
   where:{caseId:id},
   orderBy:[{createdAt:'asc'},{id:'asc'}],
   take:500
  });

  return {
   case:item,events,
   eventsTruncated:events.length===500
  };
 }

 @Post()
 async create(
  @Body() body:{
   locationId:string;sourceType:string;
   sourceId:string;summary:string;
  },
  @CurrentUser() user:Principal
 ){
  this.authorize(user,body?.locationId);

  const summary=body?.summary?.trim();

  if(
   !sourceTypes.includes(body?.sourceType)||
   !uuid.test(body?.sourceId||'')||
   !summary||summary.length>500
  ){
   throw new BadRequestException('Invalid case details');
  }

  if(!await this.sourceExists(
   body.locationId,body.sourceType,body.sourceId
  )){
   throw new NotFoundException(
    'Source not found in authorized branch'
   );
  }

  try{
   return await this.db.$transaction(async tx=>{
    const item=await tx.financeExceptionCase.create({
     data:{
      locationId:body.locationId,
      sourceType:body.sourceType,
      sourceId:body.sourceId,
      summary,
      openedById:user.id
     }
    });

    await tx.financeExceptionCaseEvent.create({
     data:{
      caseId:item.id,actorId:user.id,
      action:'OPEN',note:summary
     }
    });

    return item;
   });
  }catch(e){
   if(
    e instanceof Prisma.PrismaClientKnownRequestError&&
    e.code==='P2002'
   ){
    throw new ConflictException('Case already exists');
   }
   throw e;
  }
 }

 @Post(':id/assign')
 async assign(
  @Param('id') id:string,
  @Body() body:{assigneeId:string;note:string},
  @CurrentUser() user:Principal
 ){
  const item=await this.findCase(id,user);
  const note=body?.note?.trim();

  if(!uuid.test(body?.assigneeId||'')||
     !note||note.length>900){
   throw new BadRequestException(
    'Valid manager UUID and assignment note required'
   );
  }

  if(!['OPEN','INVESTIGATING'].includes(item.status)){
   throw new ConflictException('Case is closed');
  }

  const assignee=await this.db.user.findUnique({
   where:{id:body.assigneeId},
   select:{
    id:true,status:true,
    roles:{select:{role:{select:{code:true}}}},
    locations:{select:{locationId:true}}
   }
  });

  const codes=assignee?.roles.map(r=>r.role.code)||[];
  const global=codes.includes('SUPER_ADMIN');
  const manager=codes.includes('BRANCH_MANAGER');

  if(
   !assignee||
   assignee.status!==UserStatus.ACTIVE||
   !(global||manager)||
   (!global&&!assignee.locations.some(
    l=>l.locationId===item.locationId
   ))
  ){
   throw new BadRequestException(
    'Assignee must be an active authorized manager'
   );
  }

  return this.db.$transaction(async tx=>{
   const changed=await tx.financeExceptionCase.updateMany({
    where:{
     id:item.id,
     updatedAt:item.updatedAt,
     status:{in:['OPEN','INVESTIGATING']}
    },
    data:{assignedToId:assignee.id}
   });

   if(changed.count!==1){
    throw new ConflictException('Case changed; reload');
   }

   await tx.financeExceptionCaseEvent.create({
    data:{
     caseId:item.id,actorId:user.id,
     action:'ASSIGN',
     note:'Assigned to '+assignee.id+': '+note
    }
   });

   return tx.financeExceptionCase.findUnique({
    where:{id:item.id}
   });
  });
 }

 @Post(':id/note')
 async note(
  @Param('id') id:string,
  @Body() body:{note:string},
  @CurrentUser() user:Principal
 ){
  const item=await this.findCase(id,user);
  const note=body?.note?.trim();

  if(!note||note.length>1000){
   throw new BadRequestException(
    'Evidence note required (max 1000 characters)'
   );
  }

  if(!['OPEN','INVESTIGATING'].includes(item.status)){
   throw new ConflictException('Case is closed');
  }

  return this.db.$transaction(async tx=>{
   const changed=await tx.financeExceptionCase.updateMany({
    where:{
     id:item.id,
     status:{in:['OPEN','INVESTIGATING']},
     updatedAt:item.updatedAt
    },
    data:{updatedAt:new Date()}
   });

   if(changed.count!==1){
    throw new ConflictException('Case changed; reload');
   }

   return tx.financeExceptionCaseEvent.create({
    data:{
     caseId:item.id,actorId:user.id,
     action:'EVIDENCE_NOTE',note
    }
   });
  });
 }

 @Post(':id/transition')
 async transition(
  @Param('id') id:string,
  @Body() body:{status:string;note:string},
  @CurrentUser() user:Principal
 ){
  const item=await this.findCase(id,user);
  const note=body?.note?.trim();

  if(!note||note.length>1000){
   throw new BadRequestException(
    'Resolution reason required (max 1000 characters)'
   );
  }

  const allowed:Record<string,string[]>={
   OPEN:['INVESTIGATING','DISMISSED'],
   INVESTIGATING:['RESOLVED','DISMISSED'],
   RESOLVED:[],
   DISMISSED:[]
  };

  if(!allowed[item.status]?.includes(body.status)){
   throw new ConflictException('Invalid status transition');
  }

  const closed=['RESOLVED','DISMISSED'].includes(body.status);

  return this.db.$transaction(async tx=>{
   const changed=await tx.financeExceptionCase.updateMany({
    where:{
     id:item.id,status:item.status,
     updatedAt:item.updatedAt
    },
    data:{
     status:body.status as any,
     resolutionNote:closed?note:null,
     resolvedById:closed?user.id:null
    }
   });

   if(changed.count!==1){
    throw new ConflictException('Case changed; reload');
   }

   await tx.financeExceptionCaseEvent.create({
    data:{
     caseId:item.id,actorId:user.id,
     action:'TRANSITION_'+body.status,note
    }
   });

   return tx.financeExceptionCase.findUnique({
    where:{id:item.id}
   });
  });
 }
}