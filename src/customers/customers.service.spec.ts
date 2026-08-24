import { ForbiddenException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService sales visibility', () => {
  const salesUser = {
    id: 'sales-1',
    role: 'SALES' as const,
    email: 'sales-1@example.com',
  };

  function customer(ownerId: string, overrides: Record<string, any> = {}) {
    return {
      id: `customer-${ownerId}`,
      fullName: `Customer ${ownerId}`,
      ownerId,
      phone: '+90 555 000 0000',
      email: `${ownerId}@customer.example`,
      city: 'Kyrenia',
      country: 'Cyprus',
      address: 'Private address',
      notesSummary: 'Private notes',
      documents: [{ id: 'document-1' }],
      presentations: [],
      agency: {
        id: 'agency-1',
        assignedSalesId: 'sales-2',
        phone: '+90 555 111 1111',
        email: 'agency@example.com',
      },
      ...overrides,
    };
  }

  it('returns every customer while masking non-owner contact data', async () => {
    const prisma = {
      customer: {
        findMany: jest.fn().mockResolvedValue([
          customer('sales-1', {
            agency: {
              id: 'agency-owned',
              assignedSalesId: 'sales-1',
              phone: '+90 555 222 2222',
              email: 'owned-agency@example.com',
            },
          }),
          customer('sales-2'),
        ]),
      },
    };
    const service = new CustomersService(prisma as any, {} as any);

    const result = await service.listCustomers(salesUser);

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      phone: '+90 555 000 0000',
      canSeeContactDetails: true,
      canEdit: true,
    });
    expect(result[1]).toMatchObject({
      phone: null,
      email: null,
      city: null,
      country: null,
      documents: [],
      canSeeContactDetails: false,
      canEdit: false,
      agency: {
        phone: null,
        email: null,
      },
    });
  });

  it('allows a non-owner detail view but keeps updates forbidden', async () => {
    const otherCustomer = customer('sales-2');
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(otherCustomer),
      },
    };
    const service = new CustomersService(prisma as any, {} as any);

    await expect(
      service.getCustomerDetail(salesUser, otherCustomer.id),
    ).resolves.toMatchObject({
      phone: null,
      email: null,
      canSeeContactDetails: false,
      canEdit: false,
    });
    await expect(
      service.updateCustomer(salesUser, otherCustomer.id, {
        fullName: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
