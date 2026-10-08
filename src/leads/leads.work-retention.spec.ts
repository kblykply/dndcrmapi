import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('Lead deletion work retention', () => {
  it('does not delete independent work items when deleting lead follow-ups', async () => {
    const tx = {
      leadActivity: { deleteMany: jest.fn() },
      leadStageHistory: { deleteMany: jest.fn() },
      crmTask: { deleteMany: jest.fn() },
      task: { deleteMany: jest.fn() },
      lead: { deleteMany: jest.fn() },
    };
    const db = {
      lead: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'lead', fullName: 'Fixture' }]),
      },
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    const audit = { log: jest.fn() };
    const service = new LeadsService(
      db as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as NotificationsService,
    );
    await service.bulkDelete(
      { id: 'admin', role: 'ADMIN', email: 'admin@crm.local' },
      { ids: ['lead'] },
    );
    expect(tx.crmTask.deleteMany).not.toHaveBeenCalled();
    expect(tx.lead.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['lead'] } },
    });
  });
});
