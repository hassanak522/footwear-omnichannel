import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './module';
async function bootstrap() {
 if(process.env.NODE_ENV==='production'){
  if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||process.env.JWT_SECRET.includes('REPLACE_WITH'))throw Error('Production JWT_SECRET must be a unique secret of at least 32 characters');
  if(!process.env.DATABASE_URL)throw Error('Production DATABASE_URL is required');
  if(!process.env.CORS_ORIGIN)throw Error('Production CORS_ORIGIN must explicitly allow the storefront and HQ origins');
  if(!/^postgres(ql)?:\\/\\//.test(process.env.DATABASE_URL))throw Error('Production DATABASE_URL must use PostgreSQL');
  if(process.env.CORS_ORIGIN.split(',').some(x=>!/^https:\\/\\/[^\\s/*]+$/.test(x.trim())))throw Error('Production CORS_ORIGIN must contain HTTPS origins only, without wildcards or paths');
 }
 const app = await NestFactory.create(AppModule,{bodyParser:true});
 app.enableShutdownHooks();
 app.setGlobalPrefix('api/v1');
 app.useGlobalPipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }));
 const allowedOrigins=(process.env.CORS_ORIGIN||'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173').split(',').map(x=>x.trim()).filter(Boolean);
 app.enableCors({origin:allowedOrigins,credentials:false});
 await app.listen(Number(process.env.PORT || 3001),'0.0.0.0');
 console.log(`API listening on http://localhost:${process.env.PORT || 3001}/api/v1`);
}
bootstrap();
