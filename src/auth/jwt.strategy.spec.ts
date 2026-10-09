import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { MeController } from './me.controller';

describe('Current account permissions', () => {
  it('uses the current callcenter role even when an old token claims manager', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'cc',
            role: 'CALLCENTER',
            email: 'cc@example.test',
            isActive: true,
          }),
      },
    };
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_ACCESS_SECRET: 'synthetic-test-secret' }),
      prisma as any,
    );
    await expect(
      strategy.validate({ sub: 'cc', role: 'MANAGER' }),
    ).resolves.toMatchObject({ id: 'cc', role: 'CALLCENTER' });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'deleted', role: 'ADMIN' }),
    ).rejects.toThrow();
    await expect(strategy.validate({ role: 'ADMIN' })).rejects.toThrow();
  });
  it('rejects deactivated accounts', async () => {
    const strategy = new JwtStrategy(
      new ConfigService({ JWT_ACCESS_SECRET: 'synthetic-test-secret' }),
      {
        user: { findUnique: jest.fn().mockResolvedValue({ isActive: false }) },
      } as any,
    );
    await expect(strategy.validate({ sub: 'inactive' })).rejects.toThrow();
  });
  it('reads /auth/me using the validated request id', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'cc', role: 'CALLCENTER' });
    const controller = new MeController({ user: { findUnique } } as any);
    await controller.me({ user: { id: 'cc', role: 'CALLCENTER' } });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cc' } }),
    );
  });
});
