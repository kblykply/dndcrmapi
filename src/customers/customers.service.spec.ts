import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService manager visibility', () => {
  const manager = { id: 'manager-1', role: 'MANAGER' as const, email: 'manager@example.com' };
  const salesCustomer = {
    id: 'sales-customer',
    fullName: 'Recently added by sales',
    ownerId: 'sales-1',
    phone: '+90 555 000 0000',
    email: 'customer@example.com',
    presentations: [],
    documents: [],
  };

  it('lists sales-owned and unassigned customers with contact details, without granting edit access', async () => {
    const rows = [salesCustomer, { ...salesCustomer, id: 'unassigned', ownerId: null }];
    const prisma = { customer: { findMany: jest.fn().mockResolvedValue(rows) } };
    const service = new CustomersService(prisma as any, {} as any);
    const result = await service.listCustomers(manager);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(result).toHaveLength(2);
    result.forEach(row => expect(row).toMatchObject({
      phone: salesCustomer.phone, email: salesCustomer.email, canSeeContactDetails: true, canEdit: false,
    }));
  });

  it('honors the selected salesperson and searches their contact fields without a manager ownership restriction', async () => {
    const prisma = { customer: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new CustomersService(prisma as any, {} as any);
    await service.listCustomers(manager, { ownerId: 'sales-1', q: 'customer@example.com' });
    const where = prisma.customer.findMany.mock.calls[0][0].where;
    expect(where.ownerId).toBe('sales-1');
    expect(where.OR).toBeUndefined();
    expect(where.AND[0].OR).toContainEqual({ email: { contains: 'customer@example.com', mode: 'insensitive' } });
  });

  it('opens a salesperson customer detail but still forbids changing or deleting that customer', async () => {
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(salesCustomer) }, $transaction: jest.fn() };
    const service = new CustomersService(prisma as any, {} as any);
    await expect(service.getCustomerDetail(manager, salesCustomer.id)).resolves.toMatchObject({
      email: salesCustomer.email, canSeeContactDetails: true, canEdit: false,
    });
    await expect(service.updateCustomer(manager, salesCustomer.id, { fullName: 'Changed' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteCustomer(manager, salesCustomer.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { ownerId: manager.id, presentations: [] },
    { ownerId: 'sales-1', presentations: [{ assignedSalesId: manager.id }] },
  ])('preserves assigned manager editing: %j', async (assignment) => {
    const row = { ...salesCustomer, ...assignment };
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(row) } };
    const service = new CustomersService(prisma as any, {} as any);
    await expect(service.getCustomerDetail(manager, row.id)).resolves.toMatchObject({ canEdit: true });
  });

  it.each(['getNationalityReport', 'getDemographicsReport'] as const)('includes all customers in %s', async (method) => {
    const prisma = { customer: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new CustomersService(prisma as any, {} as any);
    await service[method](manager);
    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('keeps unrelated roles out of the customer list and detail', async () => {
    const prisma = { customer: { findUnique: jest.fn().mockResolvedValue(salesCustomer) } };
    const service = new CustomersService(prisma as any, {} as any);
    const actor = { ...manager, role: 'ACCOUNTING' as const };
    await expect(service.listCustomers(actor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getCustomerDetail(actor, salesCustomer.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

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

describe('CustomersService customer owner assignment', () => {
  const actor = { id: 'manager-1', role: 'MANAGER' as const, email: 'manager@example.com' };

  it.each(['SALES', 'MANAGER', 'ADMIN'])('creates a customer assigned to an active %s', async (role) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'owner-1', role, isActive: true }) },
      customer: { create: jest.fn().mockResolvedValue({ id: 'customer-1', fullName: 'Test', ownerId: 'owner-1' }) },
    };
    const notifications = { createManyForUsers: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomersService(prisma as any, notifications as any);

    await expect(service.createCustomer(actor, { fullName: 'Test', ownerId: 'owner-1' })).resolves.toMatchObject({ ownerId: 'owner-1' });
    expect(prisma.customer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: 'owner-1' }) }));
  });

  it.each([
    { role: 'ADMIN', isActive: false },
    { role: 'ACCOUNTING', isActive: true },
  ])('rejects an ineligible owner: %j', async (owner) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'owner-1', ...owner }) },
      customer: { create: jest.fn() },
    };
    const service = new CustomersService(prisma as any, {} as any);
    await expect(service.createCustomer(actor, { fullName: 'Test', ownerId: 'owner-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});
