import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { DigitalTeamGuard } from './digital-team.guard';
import type { DigitalTeamUser } from './digital-team.guard';

const context = (user?: DigitalTeamUser) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('DigitalTeamGuard', () => {
  const guard = new DigitalTeamGuard();
  it('allows ADMIN', () => {
    expect(guard.canActivate(context({ id: 'admin', role: 'ADMIN' }))).toBe(
      true,
    );
  });
  it.each([
    'MANAGER',
    'SALES',
    'CALLCENTER',
    'AFTERSALES',
    'ACCOUNTING',
    'PREVIEW',
  ])('rejects %s regardless of team assignment', (role) => {
    expect(() => guard.canActivate(context({ id: 'member', role }))).toThrow(
      ForbiddenException,
    );
  });
  it.each([{ originalRole: 'PREVIEW' }, { isPreview: true }])(
    'rejects rewritten preview identities',
    (flags) => {
      expect(() =>
        guard.canActivate(context({ id: 'preview', role: 'ADMIN', ...flags })),
      ).toThrow(ForbiddenException);
    },
  );
  it('requires authentication', () => {
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
  });
});
