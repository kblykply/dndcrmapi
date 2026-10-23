import { ForbiddenException } from '@nestjs/common';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
import { ROLES_KEY } from '../common/roles.decorator';

describe('sales manager unit access', () => {
  const manager = { id: 'manager', role: 'MANAGER' as const };
  const unit = { id: 'unit', customerId: 'customer', customer: { ownerId: 'sales', presentations: [] }, isCanceled: false, cancelReason: null };
  function setup() {
    const prisma = {
      customerUnitSelection: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(unit), update: jest.fn(), delete: jest.fn() },
      customerUnitSelectionLog: { createMany: jest.fn() },
      bulkEmailRecipient: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(cb => cb(prisma));
    return { prisma, service: new UnitsService(prisma as any, {} as any, {} as any) };
  }
  it('lists the same units as admin, without an ownership restriction', async () => {
    const { prisma, service } = setup();
    await service.listUnits(manager);
    const managerWhere = prisma.customerUnitSelection.findMany.mock.calls[0][0].where;
    await service.listUnits({ id: 'admin', role: 'ADMIN' });
    expect(managerWhere).toEqual(prisma.customerUnitSelection.findMany.mock.calls[1][0].where);
    expect(JSON.stringify(managerWhere)).not.toContain('ownerId');
  });
  it('opens another salesperson unit with the full change history', async () => {
    const { prisma, service } = setup();
    await expect(service.getUnit(manager, unit.id)).resolves.toMatchObject({ id: unit.id });
    const include = prisma.customerUnitSelection.findUnique.mock.calls[0][0].include;
    expect(include.logs.where).toBeUndefined();
    await expect(service.getUnit({ id: 'other', role: 'SALES' }, unit.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows update, cancellation fields and deletion for managers', async () => {
    const { prisma, service } = setup();
    await service.updateUnit(manager, unit.id, { generalInfo: 'Updated', isCanceled: false, cancelReason: null });
    expect(prisma.customerUnitSelection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ generalInfo: 'Updated', isCanceled: false }) }));
    await expect(service.deleteUnit(manager, unit.id)).resolves.toEqual({ ok: true, id: unit.id });
    expect(Reflect.getMetadata(ROLES_KEY, UnitsController.prototype.remove)).toContain('MANAGER');
    expect(prisma.customerUnitSelectionLog.createMany).toHaveBeenCalled();
  });
  it('does not grant the same destructive permissions to sales representatives', async () => {
    const { prisma, service } = setup();
    const salesperson = { id: 'sales', role: 'SALES' as const };
    await expect(service.updateUnit(salesperson, unit.id, { isCanceled: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteUnit(salesperson, unit.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.customerUnitSelection.update).not.toHaveBeenCalled();
    expect(prisma.customerUnitSelection.delete).not.toHaveBeenCalled();
  });
});
