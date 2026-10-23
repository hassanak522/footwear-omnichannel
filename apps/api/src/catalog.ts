import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Db } from './db';
import { JwtAuthGuard, RolesGuard, Roles } from './auth';
class ProductDto { @IsString() @MinLength(2) title!:string; @IsString() @MinLength(2) slug!:string; @IsUUID() categoryId!:string; @IsOptional() @IsUUID() brandId?:string; @IsOptional() @IsString() description?:string; }
class CategoryDto { @IsString() @MinLength(2) name!:string; @IsString() @MinLength(2) slug!:string; }
class VariantDto { @IsUUID() productId!:string; @IsString() sku!:string; @IsString() barcode!:string; @IsString() size!:string; @IsString() color!:string; @IsNumber() @Min(0) price!:number; @IsOptional() @IsNumber() @Min(0) cost?:number; }
@Controller('catalog') @UseGuards(JwtAuthGuard,RolesGuard)
export class CatalogController {
 constructor(private db:Db){}
 @Post('categories') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') createCategory(@Body() dto:CategoryDto){return this.db.category.create({data:dto});}
 @Get('categories') categories(){return this.db.category.findMany({orderBy:{name:'asc'}});}
 @Get('products') products(){return this.db.product.findMany({include:{variants:true,category:true,brand:true},orderBy:{createdAt:'desc'}});}
 @Get('products/:id') product(@Param('id') id:string){return this.db.product.findUniqueOrThrow({where:{id},include:{variants:true}});}
 @Post('products') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') createProduct(@Body() dto:ProductDto){return this.db.product.create({data:dto});}
 @Post('variants') @Roles('SUPER_ADMIN','ECOMMERCE_MANAGER') createVariant(@Body() dto:VariantDto){return this.db.productVariant.create({data:dto});}
}
