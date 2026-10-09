import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { Role } from '../common/types';

const user = (role: Role = 'ADMIN') => ({
  id: 'fixture-user',
  role,
  email: 'fixture@example.test',
});

describe('Lead list pagination and count contract', () => {
  const rows = [
    {
      id: 'fixture-lead',
      fullName: 'Fixture',
      avatarUrl: null,
      createdAt: new Date(0),
    },
  ];
  let db: { lead: { findMany: jest.Mock; count: jest.Mock } };
  let service: LeadsService;

  beforeEach(() => {
    db = {
      lead: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(76),
      },
    };
    service = new LeadsService(
      db as unknown as PrismaService,
      {} as AuditService,
      {} as NotificationsService,
    );
  });

  it('keeps the default 25-row response with totals and all scalar fields', async () => {
    const result = await service.listLeads(user());
    expect(result).toEqual({
      items: rows,
      total: 76,
      page: 1,
      pageSize: 25,
      totalPages: 4,
    });
    expect(db.lead.findMany).toHaveBeenCalledTimes(1);
    expect(db.lead.count).toHaveBeenCalledTimes(1);
    const query = db.lead.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      where: { archivedAt: null },
      skip: 0,
      take: 25,
    });
    expect(query.include).toBeUndefined();
    expect(query.select).toBeUndefined();
    expect(query.orderBy.at(-1)).toEqual({ id: 'asc' });
  });

  it('explicitly omits totals and does not query COUNT on a cached pagination request', async () => {
    const result = await service.listLeads(user(), {
      page: 3,
      pageSize: 25,
      includeTotal: false,
    });
    expect(result).toEqual({ items: rows, page: 3, pageSize: 25 });
    expect(db.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
    expect(db.lead.count).not.toHaveBeenCalled();
  });

  it('enforces the 100-row maximum even when the caller asks for 1000', async () => {
    const result = await service.listLeads(user(), { page: 2, pageSize: 1000 });
    expect(result.pageSize).toBe(100);
    expect(db.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 100 }),
    );
  });

  it.each([
    ['SALES', 'assignedSalesId'],
  ] as const)(
    'preserves %s row permissions with and without a total',
    async (role, field) => {
      for (const includeTotal of [true, false]) {
        await service.listLeads(user(role), {
          includeTotal,
          status: 'NEW',
          interest: 'active',
          q: ' Example ',
        });
        const query = db.lead.findMany.mock.calls.at(-1)![0];
        expect(query.where).toMatchObject({
          archivedAt: null,
          [field]: 'fixture-user',
          status: 'NEW',
        });
        expect(query.where.AND).toContainEqual({
          activities: { none: { callOutcome: 'NOT_INTERESTED' } },
        });
        expect(query.where.AND[0].OR[0]).toEqual({
          fullName: { contains: 'Example', mode: 'insensitive' },
        });
        if (includeTotal)
          expect(db.lead.count).toHaveBeenLastCalledWith({
            where: query.where,
          });
      }
      expect(db.lead.count).toHaveBeenCalledTimes(1);
    },
  );

  it('uses the same interest filter for list and total, including an empty result', async () => {
    db.lead.findMany.mockResolvedValue([]);
    db.lead.count.mockResolvedValue(0);
    const result = await service.listLeads(user(), {
      interest: 'notInterested',
      includeTotal: true,
    });
    const query = db.lead.findMany.mock.calls[0][0];
    expect(query.where.AND).toEqual([
      { activities: { some: { callOutcome: 'NOT_INTERESTED' } } },
    ]);
    expect(db.lead.count).toHaveBeenCalledWith({ where: query.where });
    expect(result).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
  });

  it('rejects disallowed roles and invalid filters before querying', async () => {
    await expect(
      service.listLeads(user('PREVIEW'), { includeTotal: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.listLeads(user(), { interest: 'invalid' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.lead.findMany).not.toHaveBeenCalled();
    expect(db.lead.count).not.toHaveBeenCalled();
  });
});

describe('Lead list query parsing', () => {
  it.each([undefined, 'true', 'false'])(
    'accepts includeTotal=%s while preserving default totals',
    (includeTotal) => {
      const listLeads = jest.fn();
      const controller = new LeadsController({
        listLeads,
      } as unknown as LeadsService);
      controller.list(
        { user: user() },
        undefined,
        '2',
        '25',
        '',
        'active',
        includeTotal,
      );
      expect(listLeads).toHaveBeenCalledWith(
        user(),
        expect.objectContaining({
          page: 2,
          pageSize: 25,
          includeTotal: includeTotal !== 'false',
        }),
      );
    },
  );

  it.each(['0', 'FALSE', 'no', ''])(
    'rejects ambiguous includeTotal=%s',
    (includeTotal) => {
      const listLeads = jest.fn();
      const controller = new LeadsController({
        listLeads,
      } as unknown as LeadsService);
      expect(() =>
        controller.list(
          { user: user() },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          includeTotal,
        ),
      ).toThrow(BadRequestException);
      expect(listLeads).not.toHaveBeenCalled();
    },
  );
});


describe('Callcenter shared lead queue', () => {
  const actor = user('CALLCENTER');
  it('lists other owners and unassigned leads without removing pagination or filters', async () => {
    const db = {lead: {findMany: jest.fn().mockResolvedValue([{id:'other-owner',ownerCallCenterId:'other'},{id:'unassigned',ownerCallCenterId:null}]),count: jest.fn().mockResolvedValue(2)}};
    const service = new LeadsService(db as any, {} as any, {} as any);
    const result = await service.listLeads(actor, {pageSize:25,status:'NEW',includeTotal:true});
    expect(result.items).toHaveLength(2);
    expect(db.lead.findMany.mock.calls[0][0].where.ownerCallCenterId).toBeUndefined();
    expect(db.lead.findMany.mock.calls[0][0].where).toMatchObject({archivedAt:null,status:'NEW'});
  });
  it('can open and schedule followups for another owner while sales stays scoped', async () => {
    const lead = {id:'other-owner',ownerCallCenterId:'other',assignedSalesId:'other',status:'WORKING'};
    const db = {lead:{findUnique:jest.fn().mockResolvedValue(lead),update:jest.fn().mockResolvedValue(lead),findMany:jest.fn().mockResolvedValue([lead])}};
    const audit = {log:jest.fn()};
    const service = new LeadsService(db as any,audit as any,{} as any);
    await expect(service.updateLeadFollowUp(actor,lead.id,{nextFollowUpAt:'2026-10-10T12:00:00Z'})).resolves.toEqual(lead);
    await expect(service.updateLeadFollowUp(user('SALES'),lead.id,{nextFollowUpAt:'2026-10-10T12:00:00Z'})).rejects.toBeInstanceOf(ForbiddenException);
    await service.listFollowups(actor,'today');
    expect(db.lead.findMany.mock.calls[0][0].where.ownerCallCenterId).toBeUndefined();
  });
});
