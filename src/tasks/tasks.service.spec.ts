import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { CrmTask, Prisma } from '@prisma/client';

describe('Work access and notifications', () => {
  const db = {
    user: { findUnique: jest.fn() },
    notification: { findMany: jest.fn() },
  };
  const gateway = { emitNotificationToUser: jest.fn() };
  const service = new TasksService(
    db as unknown as PrismaService,
    gateway as unknown as NotificationsGateway,
  );
  beforeEach(() => jest.clearAllMocks());
  it('returns preview empties without querying users or work tables', async () => {
    const preview = {
      id: 'preview',
      role: 'ADMIN',
      originalRole: 'PREVIEW',
      isPreview: true,
    };
    expect(await service.workspace(preview)).toMatchObject({
      projects: [],
      users: [],
    });
    expect(await service.listAll(preview, { skip: 0, take: 100 })).toEqual({
      items: [],
      total: 0,
    });
    expect(await service.getOne(preview, 'secret')).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
  it('does not trust an old admin role or a deactivated account', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 'u',
      name: 'User',
      role: 'SALES',
      isActive: true,
    });
    expect((await service['actor']({ id: 'u', role: 'ADMIN' })).role).toBe(
      'SALES',
    );
    db.user.findUnique.mockResolvedValue({
      id: 'u',
      role: 'ADMIN',
      isActive: false,
    });
    await expect(
      service['actor']({ id: 'u', role: 'ADMIN' }),
    ).rejects.toThrow();
  });
  it('does not fail a committed save when sockets fail', async () => {
    db.notification.findMany.mockResolvedValue([{ id: 'n', userId: 'u' }]);
    gateway.emitNotificationToUser.mockImplementation(() => {
      throw new Error('Socket unavailable');
    });
    await expect(
      service['publish']('task', new Date()),
    ).resolves.toBeUndefined();
  });
  it('does not fail a committed save when post-commit notification reads fail', async () => {
    db.notification.findMany.mockRejectedValue(new Error('Connection closed'));
    await expect(
      service['publish']('task', new Date()),
    ).resolves.toBeUndefined();
  });
  it('batches realtime lookups for bulk updates', async () => {
    db.notification.findMany.mockResolvedValue([]);
    await service['publish'](['a', 'b'], new Date());
    expect(db.notification.findMany.mock.calls[0][0].where.entityId).toEqual({
      in: ['a', 'b'],
    });
  });
  it('allows unrelated edits while the existing assignee is inactive', async () => {
    const tx = { user: { count: jest.fn().mockResolvedValue(0) } };
    const fields = await service['fields'](
      tx as unknown as Prisma.TransactionClient,
      { id: 'admin', name: 'Admin', role: 'ADMIN', isActive: true },
      { title: 'Updated', assignedToId: 'inactive' },
      null,
      { assignedToId: 'inactive' } as CrmTask,
    );
    expect(fields.title).toBe('Updated');
    expect(tx.user.count).not.toHaveBeenCalled();
    await expect(
      service['fields'](
        tx as unknown as Prisma.TransactionClient,
        { id: 'admin', name: 'Admin', role: 'ADMIN', isActive: true },
        { assignedToId: 'inactive' },
        null,
      ),
    ).rejects.toThrow();
  });
  it('filters personal-task followers per task after reassignment', async () => {
    const users = [
      { id: 'former', role: 'AFTERSALES' },
      { id: 'current', role: 'ACCOUNTING' },
      { id: 'parent-owner', role: 'CALLCENTER' },
      { id: 'sales', role: 'SALES' },
      { id: 'admin', role: 'ADMIN' },
    ];
    const tasks = [
      {
        id: 'a',
        assignedToId: 'current',
        createdById: 'creator',
        parent: { createdById: 'parent-owner' },
        agency: { assignedSalesId: 'sales' },
        customer: null,
      },
      {
        id: 'b',
        assignedToId: 'former',
        createdById: 'creator',
        parent: null,
        agency: null,
        customer: null,
      },
    ];
    const tx = {
      user: { findMany: jest.fn().mockResolvedValue(users) },
      crmTask: { findMany: jest.fn().mockResolvedValue(tasks) },
    };
    const audience = await service['notificationAudience'](
      tx as unknown as Prisma.TransactionClient,
      tasks.map((task) => ({
        ...task,
        projectId: null,
      })) as unknown as CrmTask[],
      users.map((u) => u.id),
    );
    expect([...audience.get('a')!]).toEqual([
      'current',
      'sales',
      'admin',
    ]);
    expect([...audience.get('b')!]).toEqual(['former', 'admin']);
    expect(tx.user.findMany.mock.calls[0][0].where).toMatchObject({
      isActive: true,
      role: { not: 'PREVIEW' },
    });
  });
});
