import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested
} from 'class-validator';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import {
  CurrentUser,
  JwtAuthGuard,
  Principal,
  Roles,
  RolesGuard,
  assertLocation
} from './auth';

class ClearanceLineDto {
  @IsUUID()
  variantId!:string;

  @IsInt()
  @Min(1)
  quantity!:number;
}

class ClearanceQuoteDto {
  @IsUUID()
  locationId!:string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({each:true})
  @Type(()=>ClearanceLineDto)
  lines!:ClearanceLineDto[];
}

const cents=(v:Prisma.Decimal)=>
  v.mul(100).toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
   .toNumber();

const formatted=(v:number)=>(v/100).toFixed(2);

@Controller('pos/checkout/clearance-quote')
@UseGuards(JwtAuthGuard,RolesGuard)
@Roles('SUPER_ADMIN','BRANCH_MANAGER','CASHIER')
export class PosClearanceController {
  constructor(private readonly db:Db){}

  @Post()
  async quote(
    @Body() dto:ClearanceQuoteDto,
    @CurrentUser() user:Principal
  ){
    assertLocation(user,dto.locationId);

    if(dto.lines.length>1000){
      throw new BadRequestException('Too many sale lines');
    }

    const ids=dto.lines.map(l=>l.variantId);

    if(new Set(ids).size!==ids.length){
      throw new BadRequestException('Duplicate variants');
    }

    const location=await this.db.location.findUnique({
      where:{id:dto.locationId},
      select:{id:true,type:true,active:true}
    });

    if(!location||!location.active||location.type!=='BRANCH'){
      throw new BadRequestException('Active retail branch required');
    }

    const now=new Date();

    const [variants,balances,campaigns]=await Promise.all([
      this.db.productVariant.findMany({
        where:{id:{in:ids}},
        select:{
          id:true,
          sku:true,
          price:true,
          active:true,
          product:{select:{active:true}}
        }
      }),
      this.db.stockBalance.findMany({
        where:{
          locationId:dto.locationId,
          variantId:{in:ids}
        }
      }),
      this.db.clearanceCampaign.findMany({
        where:{
          status:'ACTIVE',
          startsAt:{lte:now},
          endsAt:{gt:now},
          branches:{some:{locationId:dto.locationId}},
          variants:{some:{variantId:{in:ids}}}
        },
        include:{
          variants:{select:{variantId:true}}
        },
        orderBy:[{createdAt:'asc'},{id:'asc'}]
      })
    ]);

    const variantMap=new Map(variants.map(v=>[v.id,v]));
    const balanceMap=new Map(balances.map(b=>[b.variantId,b]));

    let subtotalCents=0;
    let discountCents=0;
    let stockReady=true;

    const lines=dto.lines.map(line=>{
      const variant=variantMap.get(line.variantId);

      if(!variant||!variant.active||!variant.product.active){
        throw new BadRequestException(
          'Unknown or inactive footwear variant: '+line.variantId
        );
      }

      const priceCents=cents(variant.price);

      if(!Number.isSafeInteger(priceCents)||priceCents<0){
        throw new BadRequestException('Invalid catalog price');
      }

      const gross=priceCents*line.quantity;

      if(!Number.isSafeInteger(gross)){
        throw new BadRequestException('Sale amount exceeds safe range');
      }

      const balance=balanceMap.get(line.variantId);

      const available=balance
        ?Math.max(
          0,
          balance.onHand-
          balance.reservedOnline-
          balance.reservedReplenish-
          balance.quarantined-
          balance.safetyBuffer
        )
        :0;

      if(available<line.quantity)stockReady=false;

      const eligible=campaigns.filter(c=>
        c.variants.some(v=>v.variantId===line.variantId)
      );

      const options=eligible
        .filter(c=>
          ['PERCENT','FIXED'].includes(c.type)&&
          c.value.gt(0)&&
          (c.type!=='PERCENT'||c.value.lte(100))
        )
        .map(c=>{
          const discount=c.type==='PERCENT'
            ?new Prisma.Decimal(gross)
              .mul(c.value)
              .div(100)
              .toDecimalPlaces(0,Prisma.Decimal.ROUND_HALF_UP)
              .toNumber()
            :cents(c.value)*line.quantity;

          return {
            campaign:c,
            discount:Math.min(gross,discount)
          };
        })
        .sort((a,b)=>
          b.discount-a.discount||
          a.campaign.code.localeCompare(b.campaign.code)
        );

      // One campaign per line. No stacking.
      const best=options[0];
      const lineDiscount=best?.discount??0;

      subtotalCents+=gross;
      discountCents+=lineDiscount;

      if(!Number.isSafeInteger(subtotalCents)||
         !Number.isSafeInteger(discountCents)){
        throw new BadRequestException('Cart amount exceeds safe range');
      }

      return {
        variantId:line.variantId,
        sku:variant.sku,
        quantity:line.quantity,
        available,
        stockReady:available>=line.quantity,
        catalogUnitPrice:formatted(priceCents),
        gross:formatted(gross),
        discount:formatted(lineDiscount),
        net:formatted(gross-lineDiscount),
        campaign:best?{
          id:best.campaign.id,
          code:best.campaign.code,
          title:best.campaign.title,
          type:best.campaign.type,
          value:best.campaign.value.toString()
        }:null
      };
    });

    return {
      locationId:dto.locationId,
      quotedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+60000).toISOString(),
      stockReady,
      subtotal:formatted(subtotalCents),
      discount:formatted(discountCents),
      total:formatted(subtotalCents-discountCents),
      lines,
      policy:{
        priceSource:'SERVER_CATALOG',
        campaignScope:'ACTIVE_BRANCH_AND_VARIANT',
        stacking:'BEST_SINGLE_CAMPAIGN_PER_LINE',
        fixedDiscount:'PER_UNIT',
        offlineAllowed:false
      },
      advisoryOnly:true,
      checkoutEnabled:false,
      warning:
        'Preview only. Final sale must recalculate discounts and stock inside its database transaction.'
    };
  }
}
