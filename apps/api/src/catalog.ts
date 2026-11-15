import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Db } from './db';
import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from './auth';
class ProductDto { @IsString() @MinLength(2) title!:string; @IsString() @MinLength(2) slug!:string; @IsUUID() categoryId!:string; @IsOptional() @IsUUID() brandId?:string; @IsOptional() @IsString() description?:string; }
class CategoryDto { @IsString() @MinLength(2) name!:string; @IsString() @MinLength(2) slug!:string; }
class VariantDto { @IsUUID() productId!:string; @IsString() sku!:string; @IsString() barcode!:string; @IsString() size!:string; @IsString() color!:string; @IsNumber() @Min(0) price!:number; @IsOptional() @IsNumber() @Min(0) cost?:number; }
class UpdateProductDto {
 @IsOptional() @IsString() @MinLength(2) title?:string;
 @IsOptional() @IsString() @MinLength(2) slug?:string;
 @IsOptional() @IsUUID() categoryId?:string;
 @IsOptional() @IsUUID() brandId?:string;
 @IsOptional() @IsString() description?:string;
 @IsOptional() @IsBoolean() active?:boolean;
}
class UpdateVariantDto {
 @IsOptional() @IsString() @MinLength(1) sku?:string;
 @IsOptional() @IsString() @MinLength(1) barcode?:string;
 @IsOptional() @IsString() @MinLength(1) size?:string;
 @IsOptional() @IsString() @MinLength(1) color?:string;
 @IsOptional() @IsNumber() @Min(0) price?:number;
 @IsOptional() @IsNumber() @Min(0) cost?:number;
 @IsOptional() @IsBoolean() active?:boolean;
}
@Controller('catalog') @UseGuards(JwtAuthGuard,RolesGuard)
export class CatalogController {
 constructor(private db:Db){}
 @Post('categories') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') createCategory(@Body() dto:CategoryDto){return this.db.category.create({data:dto});}
 @Get('categories') categories(){return this.db.category.findMany({orderBy:{name:'asc'}});}
 @Get('products') products(){return this.db.product.findMany({include:{variants:true,category:true,brand:true},orderBy:{createdAt:'desc'}});}
 @Get('products/:id') product(@Param('id') id:string){return this.db.product.findUniqueOrThrow({where:{id},include:{variants:true}});}
 @Post('products') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') createProduct(@Body() dto:ProductDto){return this.db.product.create({data:dto});}
 @Post('variants') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') createVariant(@Body() dto:VariantDto){return this.db.productVariant.create({data:dto});}
 @Patch('products/:id')
 @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER')
 async updateProduct(
  @Param('id') id:string,
  @Body() dto:UpdateProductDto
 ){
  const existing=await this.db.product.findUnique({where:{id}});
  if(!existing) throw new NotFoundException('Product not found');

  try {
   return await this.db.product.update({
    where:{id},
    data:dto,
    include:{category:true,brand:true,variants:true}
   });
  } catch(error) {
   this.handleCatalogError(error);
  }
 }

 @Patch('variants/:id')
 @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER')
 async updateVariant(
  @Param('id') id:string,
  @Body() dto:UpdateVariantDto
 ){
  const existing=await this.db.productVariant.findUnique({
   where:{id}
  });
  if(!existing) throw new NotFoundException('Variant not found');

  try {
   return await this.db.productVariant.update({
    where:{id},
    data:dto
   });
  } catch(error) {
   this.handleCatalogError(error);
  }
 }

 private handleCatalogError(error:unknown):never {
  if(error instanceof Prisma.PrismaClientKnownRequestError) {
   if(error.code==='P2002') {
    throw new ConflictException(
     'Duplicate SKU, barcode, slug or size/color combination'
    );
   }
   if(error.code==='P2003') {
    throw new BadRequestException(
     'Referenced category or brand does not exist'
    );
   }
   if(error.code==='P2025') {
    throw new NotFoundException('Catalog record not found');
   }
  }
  throw error;
 }
}
