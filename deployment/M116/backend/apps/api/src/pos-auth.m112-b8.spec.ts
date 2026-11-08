import { ForbiddenException } from '@nestjs/common';
import { assertLocation } from './auth';

describe('B8 real location authorization', () => {
  const branchA = '0b0cc789-66ce-462b-9f94-f3ab33739975';
  const branchB = 'different-branch';

  it('allows an assigned cashier', () => {
    expect(() => assertLocation({
      id: 'cashier',
      email: 'cashier@example.invalid',
      roles: ['CASHIER'],
      locations: [branchA]
    }, branchA)).not.toThrow();
  });

  it('rejects an unassigned cashier', () => {
    expect(() => assertLocation({
      id: 'cashier',
      email: 'cashier@example.invalid',
      roles: ['CASHIER'],
      locations: [branchA]
    }, branchB)).toThrow(ForbiddenException);
  });

  it('rejects an unassigned branch manager', () => {
    expect(() => assertLocation({
      id: 'manager',
      email: 'manager@example.invalid',
      roles: ['BRANCH_MANAGER'],
      locations: [branchA]
    }, branchB)).toThrow(ForbiddenException);
  });

  it('allows super admin across branches', () => {
    expect(() => assertLocation({
      id: 'admin',
      email: 'admin@example.invalid',
      roles: ['SUPER_ADMIN'],
      locations: []
    }, branchB)).not.toThrow();
  });
});
