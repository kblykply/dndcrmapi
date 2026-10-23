import { LeadsService } from './leads.service';

const user = { id: 'callcenter', role: 'CALLCENTER' as const, email: 'fixture@example.test' };

describe('Fresh inbound lead priority', () => {
  let db: any;
  let service: LeadsService;
  beforeEach(() => {
    const lead = { id: 'lead', fullName: 'Fixture', status: 'NEW', ownerCallCenterId: user.id, newPriorityAt: new Date() };
    db = {
      lead: {
        findUnique: jest.fn().mockResolvedValue(lead),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'lead', ...data })),
        update: jest.fn().mockImplementation(async ({ data }) => ({ ...lead, ...data })),
      },
      leadActivity: { create: jest.fn().mockResolvedValue({ id: 'activity' }) },
      leadStageHistory: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'manager', isActive: true, role: 'MANAGER' }) },
    };
    db.$transaction = jest.fn((fn) => fn(db));
    service = new LeadsService(db, { log: jest.fn() } as any, { createForUser: jest.fn(), createManyForUsers: jest.fn() } as any);
  });

  it('gives a newly created lead priority and the callcenter owner', async () => {
    const lead = await service.createLead(user, { fullName: 'New prospect', phone: '+905000000000' });
    expect(lead.newPriorityAt).toBeInstanceOf(Date);
    expect(lead.ownerCallCenterId).toBe(user.id);
  });

  it.each(['CALL', 'WHATSAPP', 'EMAIL', 'MEETING'] as const)('consumes priority when %s is recorded, atomically with the activity', async (type) => {
    await service.addActivity(user, 'lead', { type, summary: 'Contact recorded' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.lead.update.mock.calls[0][0].data.newPriorityAt).toBeNull();
  });

  it('retains priority when adding an internal note', async () => {
    await service.addActivity(user, 'lead', { type: 'NOTE', summary: 'Spreadsheet notes' });
    expect(db.lead.update.mock.calls[0][0].data).not.toHaveProperty('newPriorityAt');
  });

  it('retains priority when only scheduling a follow-up', async () => {
    await service.updateLeadFollowUp(user, 'lead', { nextFollowUpAt: '2026-10-24T09:00:00Z' });
    expect(db.lead.update.mock.calls[0][0].data).not.toHaveProperty('newPriorityAt');
  });

  it('clears priority when moving out of NEW', async () => {
    await service.changeStatus(user, 'lead', 'WORKING');
    expect(db.lead.update.mock.calls[0][0].data).toMatchObject({ status: 'WORKING', newPriorityAt: null });
  });

  it('clears priority on a direct manager handoff', async () => {
    await service.sendToManager(user, 'lead', 'manager');
    expect(db.lead.update.mock.calls[0][0].data).toMatchObject({ status: 'MANAGER_REVIEW', newPriorityAt: null });
  });

  it('does not consume priority if saving the activity fails', async () => {
    db.leadActivity.create.mockRejectedValue(new Error('write failed'));
    await expect(service.addActivity(user, 'lead', { type: 'CALL', summary: 'Attempt' })).rejects.toThrow('write failed');
    expect(db.lead.update).not.toHaveBeenCalled();
  });
});
