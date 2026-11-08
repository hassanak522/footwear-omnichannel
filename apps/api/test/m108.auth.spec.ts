import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { AuthService, Roles, RolesGuard, assertLocation, JwtStrategy } from '../src/auth';

const principal = (roles:string[], locations:string[] = []) => ({id:'test-user', email:'test@example.invalid', roles, locations});
const context = (user:any, handler:any, controller:any):ExecutionContext => ({
  getHandler:()=>handler, getClass:()=>controller,
  switchToHttp:()=>({getRequest:()=>({user})})
} as unknown as ExecutionContext);

describe('M108 authorization unit tests', () => {
  it('denies unassigned location', () => {
    expect(()=>assertLocation(principal(['BRANCH_MANAGER'],['branch-a']), 'branch-b')).toThrow(ForbiddenException);
  });
  it('allows assigned location', () => {
    expect(()=>assertLocation(principal(['CASHIER'],['branch-a']), 'branch-a')).not.toThrow();
  });
  it('allows super admin across locations', () => {
    expect(()=>assertLocation(principal(['SUPER_ADMIN']), 'branch-b')).not.toThrow();
  });
  it('denies cashier where branch manager is required', () => {
    class Controller {};
    class Endpoint { @Roles('SUPER_ADMIN','BRANCH_MANAGER') execute() {} }
    const guard = new RolesGuard(new Reflector());
    expect(()=>guard.canActivate(context(principal(['CASHIER']), Endpoint.prototype.execute, Controller))).toThrow(ForbiddenException);
  });
  it('allows branch manager for matching role', () => {
    class Controller {};
    class Endpoint { @Roles('SUPER_ADMIN','BRANCH_MANAGER') execute() {} }
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(context(principal(['BRANCH_MANAGER']), Endpoint.prototype.execute, Controller))).toBe(true);
  });
  it('denies missing principal on restricted handler', () => {
    class Controller {};
    class Endpoint { @Roles('SUPER_ADMIN') execute() {} }
    const guard = new RolesGuard(new Reflector());
    expect(()=>guard.canActivate(context(undefined, Endpoint.prototype.execute, Controller))).toThrow(ForbiddenException);
  });
  it('rejects invalid login password', async () => {
    const hash=await bcrypt.hash('correct-password',4);
    const db={user:{findUnique:jest.fn().mockResolvedValue({id:'u1',status:'ACTIVE',passwordHash:hash,roles:[],locations:[]})}};
    const jwt={signAsync:jest.fn()};
    const svc=new AuthService(db as any,jwt as any);
    await expect(svc.login({email:'TEST@EXAMPLE.INVALID',password:'incorrect'})).rejects.toThrow(UnauthorizedException);
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{email:'test@example.invalid'}}));
  });
  it('rejects inactive user even with correct password', async () => {
    const hash=await bcrypt.hash('correct-password',4);
    const db={user:{findUnique:jest.fn().mockResolvedValue({id:'u1',status:'INACTIVE',passwordHash:hash,roles:[],locations:[]})}};
    const svc=new AuthService(db as any,{signAsync:jest.fn()} as any);
    await expect(svc.login({email:'test@example.invalid',password:'correct-password'})).rejects.toThrow(UnauthorizedException);
  });
  it('issues token for valid login', async () => {
    const hash=await bcrypt.hash('correct-password',4);
    const db={user:{findUnique:jest.fn().mockResolvedValue({id:'u1',status:'ACTIVE',passwordHash:hash,roles:[],locations:[]})}};
    const jwt={signAsync:jest.fn().mockResolvedValue('test-token')};
    const svc=new AuthService(db as any,jwt as any);
    await expect(svc.login({email:'test@example.invalid',password:'correct-password'})).resolves.toEqual({accessToken:'test-token',tokenType:'Bearer',expiresIn:'1h'});
    expect(jwt.signAsync).toHaveBeenCalledWith({sub:'u1'});
  });
});
