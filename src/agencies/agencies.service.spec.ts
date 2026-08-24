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
