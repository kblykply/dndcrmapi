import { ConflictException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('User deletion work retention', () => {
  it('blocks force deletion before changing records when work is linked', async () => {
    const tx = {
      user: { count: jest.fn().mockResolvedValue(1), updateMany: jest.fn() },
    };
    const db = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 'worker',
            email: 'test@crm.local',
            role: 'SALES',
          }),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const controller = new UsersController(db as unknown as PrismaService);
    await expect(
      controller.forceDeleteUser({ user: { sub: 'admin' } }, 'worker'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.count).toHaveBeenCalledWith({
      where: {
        id: 'worker',
        OR: [
          { crmTasksCreated: { some: {} } },
          { crmTasksAssigned: { some: {} } },
          { workProjectsOwned: { some: {} } },
        ],
      },
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});
