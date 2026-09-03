import { BadRequestException, ConflictException } from '@nestjs/common';
import { AGENT_WHEEL_PRIZES } from './agent-wheel.catalog';
import { AgentWheelService } from './agent-wheel.service';

describe('AgentWheelService', () => {
  const user = {
    id: 'sales-1',
    role: 'SALES' as const,
    email: 'sales@example.com',
  };

  function createPrisma(previousSpin: any = null) {
    const created = {
      id: 'spin-1',
      prizeId: 'vacation',
      prizeNameTr: 'Tatil',
      prizeNameEn: 'Vacation',
      createdAt: new Date('2026-09-03T12:00:00.000Z'),
    };

    return {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: user.id,
          name: 'Sales User',
          email: user.email,
          role: user.role,
          isActive: true,
        }),
      },
      customerUnitSelection: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'unit-1',
          customerId: 'customer-1',
          project: 'LA_JOYA',
          unitNumber: 'C13',
          isCanceled: false,
          customer: {
            id: 'customer-1',
            fullName: 'Customer One',
            type: 'EXISTING',
          },
        }),
      },
      agency: {
        findUnique: jest.fn(),
      },
      agentWheelSpin: {
        findUnique: jest.fn().mockResolvedValue(previousSpin),
        create: jest
          .fn()
          .mockImplementation(({ data }) => ({ ...created, ...data })),
      },
    };
  }

  it('records a direct sale against the logged-in user and selected unit', async () => {
    const prisma = createPrisma();
    const service = new AgentWheelService(prisma as any);

    const result = await service.spin(user, {
      customerId: 'customer-1',
      unitSelectionId: 'unit-1',
      agencyId: null,
    });

    const createCall = prisma.agentWheelSpin.create.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      spunById: 'sales-1',
      spunByName: 'Sales User',
      saleType: 'DIRECT',
      agencyId: null,
      customerId: 'customer-1',
      customerName: 'Customer One',
      unitSelectionId: 'unit-1',
      unitSelectionKey: 'unit-1',
      project: 'LA_JOYA',
      block: 'C',
      unitNumber: 'C13',
    });
    expect(
      AGENT_WHEEL_PRIZES.some((prize) => prize.id === result.prizeId),
    ).toBe(true);
  });

  it('rejects a second spin for the same sale before drawing another prize', async () => {
    const prisma = createPrisma({
      id: 'existing-spin',
      prizeId: 'ipad',
      prizeNameTr: 'iPad',
      createdAt: new Date(),
    });
    const service = new AgentWheelService(prisma as any);

    await expect(
      service.spin(user, {
        customerId: 'customer-1',
        unitSelectionId: 'unit-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.agentWheelSpin.create).not.toHaveBeenCalled();
  });

  it('rejects a closed agency even when it is submitted outside the UI', async () => {
    const prisma = createPrisma();
    prisma.agency.findUnique.mockResolvedValueOnce({
      id: 'agency-1',
      name: 'Closed Agency',
      status: 'CLOSED',
    });
    const service = new AgentWheelService(prisma as any);

    await expect(
      service.spin(user, {
        customerId: 'customer-1',
        unitSelectionId: 'unit-1',
        agencyId: 'agency-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentWheelSpin.create).not.toHaveBeenCalled();
  });

  it('converts a concurrent unique-key collision into a conflict response', async () => {
    const prisma = createPrisma();
    prisma.agentWheelSpin.create.mockRejectedValueOnce({ code: 'P2002' });
    const service = new AgentWheelService(prisma as any);

    await expect(
      service.spin(user, {
        customerId: 'customer-1',
        unitSelectionId: 'unit-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
