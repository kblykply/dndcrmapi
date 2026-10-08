import {
  LogoDatabaseService,
  assertReadOnlyLogoQuery,
} from '../logo-database/logo-database.service';
import {
  PaymentTrackingCatalogService,
  type PaymentViewMetadata,
} from './payment-tracking-catalog.service';
import {
  PaymentTrackingSourceService,
  paymentTrackingCaseKey,
} from './payment-tracking-source.service';

const financialFields = [
  ['CARİ KOD', 'text'],
  ['CARİ ADI', 'text'],
  ['DAİRE', 'text'],
  ['DAİRE ADI', 'text'],
  ['PROJE KOD', 'text'],
  ['VADE', 'date'],
  ['DVZ', 'text'],
  ['TUTAR', 'number'],
  ['ODENEN', 'number'],
] as const;
const metadataFields = [
  ['CARIKODU', 'CARİ KOD', 'text'],
  ['DAIRE', 'DAİRE', 'text'],
  ['DVZ', 'DVZ', 'text'],
  ['YETKIKODU', 'YETKİ_KODU', 'text'],
  ['FATURAOK', 'FAT_OK', 'text'],
  ['SATISTEMSILCISIKODU', 'SE_KODU', 'text'],
  ['EMLAKCIKODU', 'BROKER', 'text'],
  ['FATURATARIHI', 'FAT TARİHİ', 'date'],
] as const;
const identity = {
  customerCode: 'C-7',
  unitCode: 'A-11',
  currency: 'GBP',
};
function financialRow(patch: Record<string, unknown> = {}) {
  return {
    CARIKODU: identity.customerCode,
    CARIADI: 'Synthetic customer',
    DAIRE: identity.unitCode,
    DAIREADI: 'Synthetic unit',
    PROJEKODU: 'P-1',
    VADE: new Date('2026-09-01T00:00:00Z'),
    DVZ: identity.currency,
    TOPLAMTUTAR: 100,
    TOPLAMODENEN: 20,
    ...patch,
  };
}
function metadataRow(patch: Record<string, unknown> = {}) {
  return {
    CARIKODU: identity.customerCode,
    DAIRE: identity.unitCode,
    DVZ: identity.currency,
    YETKIKODU: 'AUTH-A',
    FATURAOK: 'DND',
    SATISTEMSILCISIKODU: 'REP-A',
    EMLAKCIKODU: 'BROKER-A',
    FATURATARIHI: new Date('2026-06-01T00:00:00Z'),
    RAW_COUNT: 1,
    ...patch,
  };
}

describe('Grouped payment tracking authorization metadata', () => {
  const services: PaymentTrackingSourceService[] = [];
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T09:00:00Z'));
  });
  afterEach(() => {
    for (const service of services.splice(0)) service.onModuleDestroy();
    jest.useRealTimers();
  });

  function source(
    metadata: Record<string, unknown>[],
    finance: Record<string, unknown>[] = [financialRow()],
  ) {
    const query = jest.fn((statement: string) =>
      Promise.resolve(
        statement.startsWith('WITH PaymentAuditEligible')
          ? [
              {
                summary: JSON.stringify({
                  paymentRows: 25_000,
                  multipleStockLines: 0,
                  multipleReceiptMatches: 0,
                  cancelledInvoices: 0,
                  cancelledStockLines: 0,
                  invalidSigns: 0,
                  invalidInvoiceLinks: 0,
                  unknownCurrencies: 0,
                  nullAmounts: 0,
                  missingIdentities: 0,
                  excludedVatRows: 0,
                }),
                reviews: '[]',
              },
            ]
          : statement.includes('FROM [LOGO_DND].[dbo].[L_223_FATURA_VADE]')
            ? metadata
            : finance,
      ),
    );
    const requireView = jest.fn(
      (name: string): Promise<PaymentViewMetadata> => {
        const fields =
          name === 'L_223_FATURA_VADE'
            ? metadataFields.map(([, field, kind]) => ({ name: field, kind }))
            : financialFields.map(([field, kind]) => ({ name: field, kind }));
        return Promise.resolve({
          database: 'LOGO_DND',
          schema: 'dbo',
          name,
          sourceKind: 'VIEW',
          available: true,
          qualifiedName: `[LOGO_DND].[dbo].[${name}]`,
          columns: fields,
        });
      },
    );
    const service = new PaymentTrackingSourceService(
      { query } as unknown as LogoDatabaseService,
      { requireView } as unknown as PaymentTrackingCatalogService,
    );
    services.push(service);
    return { service, query };
  }

  it('bounds raw metadata before grouping every selected value with exact binary text keys', async () => {
    const { service, query } = source([metadataRow({ RAW_COUNT: 10 })]);
    await service.snapshot();
    const statement = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('L_223_FATURA_VADE'))!;
    expect(statement).toMatch(/^WITH \[raw\] AS \(SELECT TOP \(25001\)/);
    expect(statement).toContain(
      'CONVERT(int, COUNT_BIG(*)) AS [RAW_COUNT] FROM [raw] GROUP BY',
    );
    expect(statement.match(/TOP \(25001\)/g)).toHaveLength(1);
    const grouping = statement.split('GROUP BY ')[1];
    for (const [alias, field, kind] of metadataFields) {
      expect(statement).toContain(`[v].[${field}] AS [${alias}]`);
      expect(grouping).toContain(`[${alias}]`);
      if (kind === 'text')
        expect(grouping).toContain(`CONVERT(varbinary(max), [${alias}])`);
    }
    expect(statement).not.toMatch(/DISTINCT|RTRIM|LTRIM|UPPER|LOWER|COLLATE/i);
    expect(() => assertReadOnlyLogoQuery(statement)).not.toThrow();
    const finance = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('L_223_ODEME_PLANI'))!;
    expect(finance).toMatch(/^SELECT TOP \(25001\)/);
    expect(finance).not.toMatch(/GROUP BY|RAW_COUNT|DISTINCT/);
  });

  it.each([
    ['CARIKODU', 'customerCode', 'c-7'],
    ['CARIKODU', 'customerCode', 'C-7 '],
    ['CARIKODU', 'customerCode', null],
    ['CARIKODU', 'customerCode', ''],
    ['DAIRE', 'unitCode', 'a-11'],
    ['DAIRE', 'unitCode', 'A-11 '],
    ['DAIRE', 'unitCode', null],
    ['DAIRE', 'unitCode', ''],
    ['DVZ', 'currency', 'gbp'],
    ['DVZ', 'currency', 'GBP '],
    ['DVZ', 'currency', null],
    ['DVZ', 'currency', ''],
  ])(
    'keeps %s / %s / %p as a separate identity',
    async (alias, field, value) => {
      const patch = { [alias]: value };
      const { service } = source(
        [
          metadataRow({ RAW_COUNT: 3 }),
          metadataRow({
            ...patch,
            YETKIKODU: 'AUTH-B',
            FATURAOK: 'GÜL',
            RAW_COUNT: 7,
          }),
        ],
        [financialRow(), financialRow(patch)],
      );
      const snapshot = await service.snapshot();
      expect(snapshot.authorizationSource.matchedCases).toBe(2);
      expect(snapshot.cases).toHaveLength(2);
      expect(
        snapshot.cases.find(
          (item) => item.key === paymentTrackingCaseKey(identity),
        )?.authorization.codes,
      ).toEqual(['AUTH-A']);
      expect(
        snapshot.cases.find(
          (item) => item.key === paymentTrackingCaseKey(identity),
        )?.invoiceOk,
      ).toEqual({ status: 'matched', values: ['DND'], hasBlank: false });
      expect(
        snapshot.cases.find(
          (item) =>
            item.key ===
            paymentTrackingCaseKey({ ...identity, [field]: value }),
        )?.authorization.codes,
      ).toEqual(['AUTH-B']);
      expect(
        snapshot.cases.find(
          (item) =>
            item.key ===
            paymentTrackingCaseKey({ ...identity, [field]: value }),
        )?.invoiceOk,
      ).toEqual({ status: 'matched', values: ['GÜL'], hasBlank: false });
    },
  );

  it('preserves attribute case, trailing spaces, null and empty membership across exact duplicate groups', async () => {
    const metadata = ['AUTH-A', 'auth-a', 'AUTH-A ', null, '', ' '].map(
      (code, index) =>
        metadataRow({
          YETKIKODU: code,
          FATURAOK: code,
          SATISTEMSILCISIKODU: code,
          EMLAKCIKODU: code,
          FATURATARIHI: index === 0 ? new Date('2026-06-01T00:00:00Z') : null,
          RAW_COUNT: index + 1,
        }),
    );
    const grouped = await source(metadata).service.snapshot();
    const expanded = await source(
      metadata.flatMap((row) =>
        Array.from({ length: row.RAW_COUNT }, () => ({ ...row, RAW_COUNT: 1 })),
      ),
    ).service.snapshot();
    expect(grouped.cases).toEqual(expanded.cases);
    expect(grouped.cases[0]).toMatchObject({
      installmentCount: 1,
      amount: 100,
      paid: 20,
      outstanding: 80,
      representatives: ['AUTH-A', 'AUTH-A ', 'auth-a'],
      brokers: ['AUTH-A', 'AUTH-A ', 'auth-a'],
      invoiceDates: ['2026-06-01'],
      authorization: {
        status: 'matched',
        codes: ['AUTH-A', 'AUTH-A ', 'auth-a'],
        hasBlank: true,
      },
      invoiceOk: {
        status: 'matched',
        values: ['AUTH-A', 'AUTH-A ', 'auth-a'],
        hasBlank: true,
      },
    });
  });

  it('accepts exactly 25000 raw rows spread across groups', async () => {
    const { service } = source([
      metadataRow({ RAW_COUNT: 24_999 }),
      metadataRow({ RAW_COUNT: 1, YETKIKODU: 'AUTH-B' }),
    ]);
    const result = await service.snapshot();
    expect(result.authorizationSource.status).toBe('available');
    expect(result.cases[0].authorization.codes).toEqual(['AUTH-A', 'AUTH-B']);
  });

  it.each([[25_001], [25_000, 1]])(
    'rejects raw overflow despite the small number of grouped rows: %j',
    async (...counts) => {
      const { service } = source(
        counts.map((RAW_COUNT) => metadataRow({ RAW_COUNT })),
      );
      const result = await service.snapshot();
      expect(result.authorizationSource.status).toBe('unavailable');
      expect(result.cases[0]).toMatchObject({
        outstanding: 80,
        authorization: { status: 'unavailable', codes: [], hasBlank: false },
      });
    },
  );

  it('rejects more than 25000 grouped rows', async () => {
    const { service } = source(
      Array.from({ length: 25_001 }, () => metadataRow()),
    );
    expect((await service.snapshot()).authorizationSource.status).toBe(
      'unavailable',
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['fraction', 1.5],
    ['NaN', NaN],
    ['infinity', Infinity],
    ['negative infinity', -Infinity],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['numeric text', '1'],
    ['boolean', true],
  ])('discards all metadata when a count is %s', async (_label, RAW_COUNT) => {
    const broken: Record<string, unknown> = metadataRow({ RAW_COUNT });
    if (RAW_COUNT === undefined) delete broken.RAW_COUNT;
    const { service } = source([metadataRow(), broken]);
    const result = await service.snapshot();
    expect(result.authorizationSource.status).toBe('unavailable');
    expect(result.cases[0]).toMatchObject({
      outstanding: 80,
      representatives: [],
      brokers: [],
      invoiceDates: [],
      authorization: { status: 'unavailable', codes: [], hasBlank: false },
    });
  });

  it('keeps an empty metadata source available without inventing matches', async () => {
    const { service } = source([]);
    const result = await service.snapshot();
    expect(result.authorizationSource.status).toBe('available');
    expect(result.cases[0].authorization.status).toBe('unmatched');
  });
});
