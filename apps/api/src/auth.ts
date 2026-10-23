import { Body, Controller, Injectable, Post, UnauthorizedException, UseGuards, ExecutionContext, CanActivate, SetMetadata, ForbiddenException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { IsEmail, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { Db } from './db';
export class LoginDto { @IsEmail() email!:string; @IsString() @MinLength(1) password!:string; }
@Injectable()
export class AuthService {
 constructor(private db:Db,private jwt:JwtService){}
 async login(dto:LoginDto){
  const user=await this.db.user.findUnique({where:{email:dto.email.toLowerCase()},include:{roles:{include:{role:true}},locations:true}});
  if(!user || user.status!=='ACTIVE' || !(await bcrypt.compare(dto.password,user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
  return {accessToken:await this.jwt.signAsync({sub:user.id}),tokenType:'Bearer',expiresIn:'1h'};
 }
}
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy){
 constructor(private db:Db){super({jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(),ignoreExpiration:false,secretOrKey:process.env.JWT_SECRET!});}
 async validate(payload:{sub:string}){
  const user=await this.db.user.findUnique({where:{id:payload.sub},include:{roles:{include:{role:true}},locations:true}});
  if(!user || user.status!=='ACTIVE') throw new UnauthorizedException();
  return {id:user.id,email:user.email,roles:user.roles.map(r=>r.role.code),locations:user.locations.map(l=>l.locationId)};
 }
}
export type Principal={id:string;email:string;roles:string[];locations:string[]};
export const CurrentUser=createParamDecorator((_data:unknown,ctx:ExecutionContext):Principal=>ctx.switchToHttp().getRequest().user);
export const Roles=(...roles:string[])=>SetMetadata('roles',roles);
@Injectable()
export class RolesGuard implements CanActivate {
 constructor(private reflector:Reflector){}
 canActivate(ctx:ExecutionContext){
  const required=this.reflector.getAllAndOverride<string[]>('roles',[ctx.getHandler(),ctx.getClass()]);
  if(!required?.length)return true;
  const user=ctx.switchToHttp().getRequest().user as Principal;
  if(!user || !required.some(r=>user.roles.includes(r)))throw new ForbiddenException();
  return true;
 }
}
export const JwtAuthGuard=AuthGuard('jwt');
@Controller('auth') export class AuthController { constructor(private auth:AuthService){} @Post('login') login(@Body() dto:LoginDto){return this.auth.login(dto);} }
export function assertLocation(user:Principal, locationId:string){if(!user.roles.includes('SUPER_ADMIN') && !user.locations.includes(locationId))throw new ForbiddenException('Location not assigned');}
