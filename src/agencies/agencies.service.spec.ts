import { ForbiddenException } from '@nestjs/common';
import { AgenciesService } from './agencies.service';

describe('AgenciesService sales visibility', () => {
  const salesUser = {
    id: 'sales-1',
    role: 'SALES' as const,
    email: 'sales-1@example.com',
  };

  function agency(assignedSalesId: string) {
    return {
      id: `agency-${assignedSalesId}`,
      name: `Agency ${assignedSalesId}`,
      assignedSalesId,
      contactName: 'Private contact',
      phone: '+90 555 000 0000',
      email: `${assignedSalesId}@agency.example`,
      address: 'Private address',
      website: 'https://agency.example',
      source: 'Referral',
      notesSummary: 'Private notes',
      assignedSales: {
        id: assignedSalesId,
        name: assignedSalesId,
        email: `${assignedSalesId}@example.com`,
        role: 'SALES',
      },
    };
  }

  it('returns every agency while masking non-owner contact data', async () => {
    const prisma = {
      agency: {
        findMany: jest
          .fn()
          .mockResolvedValue([agency('sales-1'), agency('sales-2')]),
        count: jest.fn().mockResolvedValue(2),
      },
    };
    const service = new AgenciesService(prisma as any, {} as any);

    const result = await service.listAgencies(salesUser);

    expect(prisma.agency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result.items[0]).toMatchObject({
      phone: '+90 555 000 0000',
      canSeeContactDetails: true,
      canEdit: true,
    });
    expect(result.items[1]).toMatchObject({
      contactName: null,
      phone: null,
      email: null,
      canSeeContactDetails: false,
      canEdit: false,
    });
  });

  it('allows a non-owner detail view but keeps updates forbidden', async () => {
    const otherAgency = agency('sales-2');
    const prisma = {
      agency: {
        findUnique: jest.fn().mockResolvedValue(otherAgency),
      },
    };
    const service = new AgenciesService(prisma as any, {} as any);

    await expect(
      service.getAgency(salesUser, otherAgency.id),
    ).resolves.toMatchObject({
      phone: null,
      email: null,
      canSeeContactDetails: false,
      canEdit: false,
    });
    await expect(
      service.updateAgency(salesUser, otherAgency.id, { name: 'Changed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AgenciesService manager access', () => {
  const manager = { id: 'manager', role: 'MANAGER' as const, email: 'manager@example.com' };
  const rows = [
    { id: 'other', assignedSalesId: 'sales', phone: '123', email: 'agency@example.com' },
    { id: 'unassigned', assignedSalesId: null, phone: '456', email: 'unassigned@example.com' },
  ];
  const make = () => {
    const prisma = { agency: { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(2), findUnique: jest.fn().mockResolvedValue(rows[0]) } };
    return { prisma, service: new AgenciesService(prisma as any, {} as any) };
  };
  it.each([undefined, 'all'])('includes all agencies by default or with scope=%s', async (scope) => {
    const { prisma, service } = make();
    const result = await service.listAgencies(manager, { scope });
    expect(prisma.agency.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(prisma.agency.count).toHaveBeenCalledWith({ where: {} });
    expect(result.items).toEqual(rows.map(row => ({ ...row, canEdit: true, canSeeContactDetails: true })));
    await expect(service.getAgency(manager, 'other')).resolves.toMatchObject({ phone: '123', canEdit: true });
  });
  it('honors an explicit salesperson filter', async () => {
    const { prisma, service } = make();
    await service.listAgencies(manager, { assignedSalesId: 'sales' });
    expect(prisma.agency.count).toHaveBeenCalledWith({ where: { assignedSalesId: 'sales' } });
  });
  it('keeps the explicit personal scope available', async () => {
    const { prisma, service } = make();
    await service.listAgencies(manager, { scope: 'mine', assignedSalesId: 'sales' });
    expect(prisma.agency.count).toHaveBeenCalledWith({ where: { assignedSalesId: 'manager' } });
  });
});

describe('manager actions on other salespeople agencies', () => {
  const manager = { id: 'manager', role: 'MANAGER' as const, email: 'manager@example.com' };
  const agency = { id: 'agency', assignedSalesId: 'sales', name: 'Agency' };
  it('can edit and delete an agency assigned to another salesperson', async () => {
    const prisma = {
      agency: { findUnique: jest.fn().mockResolvedValue(agency), update: jest.fn().mockResolvedValue(agency), delete: jest.fn() },
      agencyTask: { deleteMany: jest.fn() }, agencyMeeting: { deleteMany: jest.fn() }, agencyNote: { deleteMany: jest.fn() },
      customer: { updateMany: jest.fn() }, $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(cb => cb(prisma));
    const service = new AgenciesService(prisma as any, { createManyForUsers: jest.fn() } as any);
    await service.updateAgency(manager, agency.id, { name: 'New name' });
    expect(prisma.agency.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'New name' } }));
    await expect(service.deleteAgency(manager, agency.id)).resolves.toEqual({ success: true });
    expect(prisma.agency.delete).toHaveBeenCalledWith({ where: { id: agency.id } });
    await expect(service.deleteAgency({ ...manager, role: 'SALES' }, agency.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('can edit a task on any agency, while sales may edit only assigned tasks', async () => {
    const task = { id: 'task', agencyId: agency.id, agency, assignedToId: 'sales' };
    const prisma = { agencyTask: { findUnique: jest.fn().mockResolvedValue(task), update: jest.fn().mockResolvedValue(task) } };
    const service = new AgenciesService(prisma as any, { createManyForUsers: jest.fn() } as any);
    await service.updateTask(manager, task.id, { title: 'Updated task' });
    expect(prisma.agencyTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'Updated task' } }));
    await expect(service.updateTask({ ...manager, role: 'SALES' }, task.id, { title: 'Blocked' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
