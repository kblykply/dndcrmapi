import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { DigitalMapGuard } from './digital-map.guard';
import type { DigitalMapUser } from './digital-map.guard';

function context(user?: DigitalMapUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('DigitalMapGuard', () => {
  const guard = new DigitalMapGuard();

  it('allows ADMIN', () => {
    expect(guard.canActivate(context({ id: 'user', role: 'ADMIN' }))).toBe(
      true,
    );
  });

  it.each([
    'MANAGER',
    'PREVIEW',
    'SALES',
    'CALLCENTER',
    'ACCOUNTING',
    'AFTERSALES',
  ])('rejects %s before the preview interceptor', (role) => {
    expect(() => guard.canActivate(context({ id: 'user', role }))).toThrow(
      ForbiddenException,
    );
  });

  it.each([
    { role: 'ADMIN', originalRole: 'PREVIEW' },
    { role: 'ADMIN', isPreview: true },
    { role: 'MANAGER', isPreview: true },
  ])('rejects rewritten preview identity %p', (identity) => {
    expect(() =>
      guard.canActivate(context({ id: 'preview', ...identity })),
    ).toThrow(ForbiddenException);
  });

  it('requires an authenticated identity', () => {
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
  });
});
