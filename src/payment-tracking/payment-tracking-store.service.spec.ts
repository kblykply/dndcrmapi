import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { PaymentTrackingCase, PaymentTrackingEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentTrackingStoreService,
  type PaymentTrackingStoreInput,
} from './payment-tracking-store.service';

const key = 'a'.repeat(64);
const secondKey = 'b'.repeat(64);
const now = new Date('2026-09-29T10:00:00.000Z');
const identity = {
  customerCode: 'C-123-2',
  unitCode: 'LJ/A/7',
  currency: 'GBP',
};
const actor = {
  id: 'accountant',
  role: 'ACCOUNTING',
  name: 'Untrusted input name',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function input(
  overrides: Partial<PaymentTrackingStoreInput> = {},
): PaymentTrackingStoreInput {
  return {
    key,
    sourceIdentity: identity,
    actor,
    type: 'defer',
    expectedVersion: 0,
    trackingDate: '2026-10-01',
    body: 'Müşteri yeni tarihte aranacak.',
    ...overrides,
  };
}

function fixture() {
  let rows: PaymentTrackingCase[] = [];
  let events: PaymentTrackingEvent[] = [];
  const users = [
    { id: 'accountant', name: 'Muhasebe', role: 'ACCOUNTING', isActive: true },
    { id: 'admin', name: 'Yönetici', role: 'ADMIN', isActive: true },
    { id: 'sales', name: 'Satış', role: 'SALES', isActive: true },
    { id: 'preview', name: 'Önizleme', role: 'PREVIEW', isActive: true },
    { id: 'inactive', name: 'Eski hesap', role: 'ACCOUNTING', isActive: false },
  ];
  const tx = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(users.find((user) => user.id === where.id) ?? null),
      ),
      findMany: jest.fn(() =>
        Promise.resolve(
          users
            .filter(
              (user) =>
                user.isActive && ['ADMIN', 'ACCOUNTING'].includes(user.role),
            )
            .map(({ id, name, role }) => ({ id, name, role })),
        ),
      ),
    },
    paymentTrackingCase: {
      findMany: jest.fn(({ where }: { where: { key?: { in: string[] } } }) =>
        Promise.resolve(
          rows
            .filter((row) => !where.key || where.key.in.includes(row.key))
            .map((row) => structuredClone(row)),
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve(
          structuredClone(rows.find((row) => row.key === where.key) ?? null),
        ),
      ),
      findUniqueOrThrow: jest.fn(({ where }: { where: { key: string } }) => {
        const row = rows.find((row) => row.key === where.key);
        if (!row)
          return Promise.reject(
            Object.assign(new Error('Missing row'), { code: 'P2025' }),
          );
        return Promise.resolve(structuredClone(row));
      }),
      create: jest.fn(
        ({
          data,
        }: {
          data: Partial<PaymentTrackingCase> &
            Pick<PaymentTrackingCase, 'key' | 'sourceIdentity'>;
        }) => {
          if (rows.some((row) => row.key === data.key))
            return Promise.reject(
              Object.assign(new Error('Duplicate key'), { code: 'P2002' }),
            );
          const row: PaymentTrackingCase = {
            trackingDate: null,
            priority: 'normal',
            version: 1,
            assigneeId: null,
            assigneeName: null,
            createdById: null,
            createdByName: '',
            updatedById: null,
            updatedByName: '',
            createdAt: now,
            updatedAt: now,
            ...data,
          };
          rows.push(row);
          return Promise.resolve(structuredClone(row));
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { key: string; version: number };
          data: Omit<Partial<PaymentTrackingCase>, 'version'> & {
            version: { increment: number };
          };
        }) => {
          const row = rows.find(
            (row) => row.key === where.key && row.version === where.version,
          );
          if (!row) return Promise.resolve({ count: 0 });
          const { version, ...fields } = data;
          Object.assign(row, fields);
          row.version += version.increment;
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    paymentTrackingEvent: {
      create: jest.fn(
        ({
          data,
        }: {
          data: Omit<PaymentTrackingEvent, 'id' | 'createdAt'>;
        }) => {
          const event = {
            id: `event-${events.length + 1}`,
            createdAt: now,
            ...data,
          };
          events.push(event);
          return Promise.resolve(structuredClone(event));
        },
      ),
      findMany: jest.fn(
        ({ where, take }: { where: { caseKey: string }; take: number }) =>
          Promise.resolve(
            events
              .filter((event) => event.caseKey === where.caseKey)
              .slice()
              .reverse()
              .slice(0, take)
              .map((event) => structuredClone(event)),
          ),
      ),
    },
  };
  const db = {
    ...tx,
    $transaction: jest.fn(
      async (operation: (transaction: typeof tx) => Promise<unknown>) => {
        const beforeRows = structuredClone(rows);
        const beforeEvents = structuredClone(events);
        try {
          return await operation(tx);
        } catch (error) {
          rows = beforeRows;
          events = beforeEvents;
          throw error;
        }
      },
    ),
  };
  const store = new PaymentTrackingStoreService(db as unknown as PrismaService);
  return { store, db, users, rows: () => rows, events: () => events };
}

describe('PaymentTrackingStoreService', () => {
  it('never creates overlay records while reading; empty keys do not request all cases', async () => {
    const { store, db } = fixture();
    expect(await store.get(key)).toBeNull();
    expect(await store.getMany([])).toEqual([]);
    expect(db.paymentTrackingCase.findMany).not.toHaveBeenCalled();
    expect(await store.getMany()).toEqual([]);
    expect(await store.history(key)).toEqual({ items: [], hasMore: false });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.paymentTrackingCase.create).not.toHaveBeenCalled();
  });

  it('creates on version zero and persists only exact source references with real actor names', async () => {
    const { store, rows, events } = fixture();
    const sourceIdentity = {
      ...identity,
      amount: 999,
      customerName: 'Do not persist',
    };
    const result = await store.apply(input({ sourceIdentity }));
    expect(result).toMatchObject({
      key,
      sourceIdentity: identity,
      trackingDate: '2026-10-01',
      version: 1,
      updatedByName: 'Muhasebe',
    });
    expect(rows()[0].sourceIdentity).toEqual(identity);
    expect(rows()[0]).toMatchObject({
      createdById: 'accountant',
      createdByName: 'Muhasebe',
      updatedByName: 'Muhasebe',
    });
    expect(events()[0]).toMatchObject({
      type: 'defer',
      actorId: 'accountant',
      actorName: 'Muhasebe',
      beforeDate: null,
      afterDate: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('preserves source references, records before/after dates and resets only the tracking date', async () => {
    const { store, rows } = fixture();
    await store.apply(input());
    await store.apply(
      input({ expectedVersion: 1, trackingDate: '2026-10-03' }),
    );
    const reset = await store.apply(
      input({
        expectedVersion: 2,
        type: 'reset',
        body: 'Kaynak takvimine dönüldü.',
      }),
    );
    expect(reset).toMatchObject({
      trackingDate: null,
      version: 3,
      sourceIdentity: identity,
    });
    const history = await store.history(key);
    expect(history.items[0]).toMatchObject({
      type: 'reset',
      previousDate: '2026-10-03',
      nextDate: null,
    });
    expect(history.items[1]).toMatchObject({
      type: 'defer',
      previousDate: '2026-10-01',
      nextDate: '2026-10-03',
    });
    expect(rows()).toHaveLength(1);
  });

  it('gets requested keys only, deduplicating repeated keys; unfiltered reads include orphan candidates', async () => {
    const { store, db } = fixture();
    await store.apply(input());
    await store.apply(input({ key: secondKey }));
    expect(await store.getMany([key, key])).toHaveLength(1);
    expect(db.paymentTrackingCase.findMany).toHaveBeenLastCalledWith({
      where: { key: { in: [key] } },
      orderBy: { key: 'asc' },
    });
    expect(await store.getMany()).toHaveLength(2);
  });

  it('rejects stale create/update and a missing case with nonzero version without extra events', async () => {
    const { store, events } = fixture();
    await store.apply(input());
    await expect(store.apply(input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      store.apply(input({ expectedVersion: 8 })),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      store.apply(input({ key: secondKey, expectedVersion: 1 })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(events()).toHaveLength(1);
  });

  it('detects a concurrent update at the conditional write, even after a matching read', async () => {
    const { store, db, events } = fixture();
    await store.apply(input());
    db.paymentTrackingCase.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      store.apply(input({ expectedVersion: 1 })),
    ).rejects.toBeInstanceOf(ConflictException);
    const conditionalWrite = db.paymentTrackingCase.updateMany.mock.calls[0][0];
    expect(conditionalWrite.where).toEqual({ key, version: 1 });
    expect(conditionalWrite.data.version).toEqual({ increment: 1 });
    expect(events()).toHaveLength(1);
    expect((await store.get(key))?.version).toBe(1);
  });

  it.each(['P2002', 'P2025', 'P2034'])(
    'maps database concurrency error %s to HTTP 409',
    async (code) => {
      const { store, db, rows, events } = fixture();
      db.paymentTrackingCase.create.mockRejectedValueOnce({ code });
      await expect(store.apply(input())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(rows()).toHaveLength(0);
      expect(events()).toHaveLength(0);
    },
  );

  it('rolls back both first creation and an existing update when its event cannot be recorded', async () => {
    const { store, db, rows, events } = fixture();
    db.paymentTrackingEvent.create.mockRejectedValueOnce(
      new Error('event write failed'),
    );
    await expect(store.apply(input())).rejects.toThrow('event write failed');
    expect(rows()).toHaveLength(0);
    await store.apply(input());
    db.paymentTrackingEvent.create.mockRejectedValueOnce(
      new Error('event write failed'),
    );
    await expect(
      store.apply(input({ expectedVersion: 1, trackingDate: '2026-12-01' })),
    ).rejects.toThrow('event write failed');
    expect(await store.get(key)).toMatchObject({
      trackingDate: '2026-10-01',
      version: 1,
    });
    expect(events()).toHaveLength(1);
  });

  it('refuses source identity changes under an existing case key', async () => {
    const { store, events } = fixture();
    await store.apply(input());
    await expect(
      store.apply(
        input({
          expectedVersion: 1,
          sourceIdentity: { ...identity, customerCode: 'C-123' },
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(events()).toHaveLength(1);
  });

  it('filters assignables and revalidates active eligible assignees in the transaction', async () => {
    const { store, db, events } = fixture();
    expect(await store.assignables()).toEqual([
      { id: 'accountant', name: 'Muhasebe', role: 'ACCOUNTING' },
      { id: 'admin', name: 'Yönetici', role: 'ADMIN' },
    ]);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, role: { in: ['ADMIN', 'ACCOUNTING'] } },
      }),
    );
    for (const assigneeId of ['sales', 'preview', 'inactive', 'missing']) {
      await expect(
        store.apply(input({ type: 'assign', assigneeId })),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(events()).toHaveLength(0);
    expect(
      await store.apply(
        input({ type: 'assign', assigneeId: 'admin', body: '' }),
      ),
    ).toMatchObject({
      assigneeId: 'admin',
      assigneeName: 'Yönetici',
      version: 1,
    });
    expect((await store.history(key)).items[0].body).toContain('Yönetici');
    expect(
      await store.apply(
        input({ type: 'assign', assigneeId: null, expectedVersion: 1 }),
      ),
    ).toMatchObject({ assigneeId: null, assigneeName: null, version: 2 });
  });

  it('checks token role and fresh database account before writes', async () => {
    const { store, db, rows } = fixture();
    for (const role of ['SALES', 'PREVIEW', 'MANAGER']) {
      await expect(
        store.apply(input({ actor: { ...actor, role } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    for (const id of ['sales', 'preview', 'inactive', 'missing']) {
      await expect(
        store.apply(input({ actor: { ...actor, id } })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(rows()).toHaveLength(0);
  });

  it.each([
    { trackingDate: '2026-02-30' },
    { trackingDate: '2026-10-01T12:00:00Z' },
    { trackingDate: 'invalid' },
    { expectedVersion: -1 },
    { expectedVersion: 0.5 },
    { body: 'x'.repeat(2001) },
    { body: '   ' },
    { key: 'invalid' },
    { type: 'priority', priority: 'urgent' },
    { type: 'assign', assigneeId: '' },
    { type: 'contact', channel: 'sms' },
  ])(
    'rejects invalid persistence input %j before a transaction',
    async (badInput) => {
      const { store, db } = fixture();
      await expect(
        store.apply(input(badInput as Partial<PaymentTrackingStoreInput>)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('saves priority, note and compose history without changing dates or storing contact details implicitly', async () => {
    const { store, events } = fixture();
    await store.apply(input());
    await store.apply(
      input({
        type: 'priority',
        priority: 'high',
        expectedVersion: 1,
        body: '',
      }),
    );
    await store.apply(
      input({
        type: 'note',
        expectedVersion: 2,
        body: 'Geri dönüş bekleniyor.',
      }),
    );
    const result = await store.apply(
      input({
        type: 'contact',
        channel: 'whatsapp',
        expectedVersion: 3,
        body: 'Mesaj taslağı açıldı.',
      }),
    );
    expect(result).toMatchObject({
      priority: 'high',
      trackingDate: '2026-10-01',
      version: 4,
    });
    expect(events()[3]).toMatchObject({
      type: 'contact',
      channel: 'whatsapp',
      beforeDate: null,
      afterDate: null,
    });
    expect(events()[3]).not.toHaveProperty('recipient');
  });

  it('returns the last 100 events with an explicit continuation flag and deterministic tie-breaker', async () => {
    const { store, db } = fixture();
    await store.apply(input());
    for (let version = 1; version < 101; version++) {
      await store.apply(
        input({
          type: 'note',
          body: `Not ${version}`,
          expectedVersion: version,
        }),
      );
    }
    const history = await store.history(key);
    expect(history.items).toHaveLength(100);
    expect(history.hasMore).toBe(true);
    expect(history.items[0].body).toBe('Not 100');
    expect(db.paymentTrackingEvent.findMany).toHaveBeenCalledWith({
      where: { caseKey: key },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
    });
  });

  it('preserves source whitespace and nullable references; no currency or customer-name inference', async () => {
    const { store, rows } = fixture();
    const sourceIdentity = {
      customerCode: ' C-1 ',
      unitCode: '',
      currency: null,
    };
    const result = await store.apply(
      input({ sourceIdentity, type: 'note', body: 'Kaynak kontrolü' }),
    );
    expect(result.sourceIdentity).toEqual(sourceIdentity);
    expect(rows()[0].sourceIdentity).toEqual(sourceIdentity);
  });

  it('retains only Logo identity codes when legacy CRM IDs are present in stored input', async () => {
    const { store, rows } = fixture();
    const legacyIdentity = { ...identity, customerId: 123, apartmentId: 456 };
    const result = await store.apply(
      input({
        sourceIdentity: legacyIdentity,
        type: 'note',
        body: 'Kaynak kontrolü',
      }),
    );
    expect(result.sourceIdentity).toEqual(identity);
    expect(rows()[0].sourceIdentity).toEqual(identity);
  });
});

describe('Payment tracking assignee cache', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('isolates cached results and expires the list after 30 seconds', async () => {
    const { store, db, users } = fixture();
    const first = await store.assignables();
    first[0].name = 'Changed by caller';
    users[0].name = 'New live name';
    expect((await store.assignables())[0].name).toBe('Muhasebe');
    await jest.advanceTimersByTimeAsync(29_999);
    await store.assignables();
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect((await store.assignables())[0].name).toBe('New live name');
    expect(db.user.findMany).toHaveBeenCalledTimes(2);
  });

  it('shares in-flight reads including force requests but returns independent copies', async () => {
    const { store, db } = fixture();
    const live = deferred<Array<{ id: string; name: string; role: string }>>();
    db.user.findMany.mockReturnValueOnce(live.promise);
    const first = store.assignables();
    const second = store.assignables();
    const forced = store.assignables(true);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    live.resolve([{ id: 'admin', name: 'Admin', role: 'ADMIN' }]);
    const results = await Promise.all([first, second, forced]);
    results[0][0].name = 'Caller changed';
    expect(results[1][0].name).toBe('Admin');
    expect(results[2][0].name).toBe('Admin');
    expect((await store.assignables())[0].name).toBe('Admin');
  });

  it('bypasses fresh cached assignees on force and clears stale results after failure', async () => {
    const { store, db, users } = fixture();
    await store.assignables();
    users[0].isActive = false;
    const forced = await store.assignables(true);
    expect(forced.map((user) => user.id)).toEqual(['admin']);
    expect(db.user.findMany).toHaveBeenCalledTimes(2);
    db.user.findMany.mockRejectedValueOnce(new Error('Synthetic read failure'));
    await expect(store.assignables(true)).rejects.toThrow(
      'Synthetic read failure',
    );
    await store.assignables();
    expect(db.user.findMany).toHaveBeenCalledTimes(4);
  });

  it('does not use cached eligibility when an assignee becomes inactive before a write', async () => {
    const { store, users, db, events } = fixture();
    expect(
      (await store.assignables()).some((user) => user.id === 'admin'),
    ).toBe(true);
    users.find((user) => user.id === 'admin')!.isActive = false;
    await expect(
      store.apply(input({ type: 'assign', assigneeId: 'admin' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin' },
      select: { id: true, name: true, role: true, isActive: true },
    });
    expect(events()).toHaveLength(0);
  });
});
