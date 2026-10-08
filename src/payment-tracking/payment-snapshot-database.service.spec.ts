import { ServiceUnavailableException } from '@nestjs/common';
import { PaymentSnapshotDatabaseService } from './payment-snapshot-database.service';
import {
  CONTACT_SNAPSHOT_QUERY,
  paymentSnapshotKey,
} from './payment-snapshot-key';

describe('Private Supabase finance snapshot', () => {
  const previousMode = process.env.PAYMENT_SOURCE_MODE;
  beforeEach(() => {
    delete process.env.PAYMENT_SOURCE_MODE;
  });
  afterAll(() => {
    if (previousMode === undefined) delete process.env.PAYMENT_SOURCE_MODE;
    else process.env.PAYMENT_SOURCE_MODE = previousMode;
  });

  it('reads the active imported dataset without connecting to Logo', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          {
            payload: [{ TUTAR: 10 }],
            importedAt: new Date('2026-10-09T00:00:00Z'),
          },
        ]),
    };
    const service = new PaymentSnapshotDatabaseService(
      {} as any,
      prisma as any,
    );
    await expect(service.query('SELECT verified_finance')).resolves.toEqual([
      { TUTAR: 10 },
    ]);
    expect(service.importedAt).toBe('2026-10-09T00:00:00.000Z');
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe(
      paymentSnapshotKey('SELECT verified_finance'),
    );
  });

  it('fails closed when no imported dataset matches the application query', async () => {
    const service = new PaymentSnapshotDatabaseService(
      {} as any,
      { $queryRaw: jest.fn().mockResolvedValue([]) } as any,
    );
    await expect(
      service.query('SELECT changed_finance'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('preserves exact customer contact identity and the ambiguity row limit', async () => {
    const payload = [
      { customerCode: 'ABC', phone: '1' },
      { customerCode: 'abc', phone: '2' },
      ...Array.from({ length: 105 }, () => ({
        customerCode: 'many',
        phone: '3',
      })),
    ];
    const service = new PaymentSnapshotDatabaseService(
      {} as any,
      {
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ payload, importedAt: new Date() }]),
      } as any,
    );
    await expect(
      service.query(CONTACT_SNAPSHOT_QUERY, { customerCode: 'ABC' }),
    ).resolves.toEqual([{ customerCode: 'ABC', phone: '1' }]);
    expect(
      await service.query(CONTACT_SNAPSHOT_QUERY, { customerCode: 'many' }),
    ).toHaveLength(101);
  });

  it('keys metadata by view and leaves SQL text and parameters significant', () => {
    expect(paymentSnapshotKey('SELECT metadata', { viewName: 'one' })).not.toBe(
      paymentSnapshotKey('SELECT metadata', { viewName: 'two' }),
    );
    expect(paymentSnapshotKey('SELECT one')).not.toBe(
      paymentSnapshotKey('SELECT two'),
    );
  });
});
