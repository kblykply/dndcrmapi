import { PaymentTrackingCatalogService } from './payment-tracking-catalog.service';
import {
  LogoDatabaseService,
  assertReadOnlyLogoQuery,
} from '../logo-database/logo-database.service';

describe('PaymentTrackingCatalogService', () => {
  const metadata = {
    databaseName: 'LOGO_DND',
    schemaName: 'dbo',
    viewName: 'L_223_ODEME_PLANI',
    columnName: 'VADE',
    dataType: 'datetime',
  };
  let query: jest.Mock;
  let catalog: PaymentTrackingCatalogService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([metadata]);
    catalog = new PaymentTrackingCatalogService({
      query,
    } as unknown as LogoDatabaseService);
  });
  it('verifies the current view against Logo metadata with parameterized names', async () => {
    const result = await catalog.requireView('L_223_ODEME_PLANI');
    expect(result).toMatchObject({
      database: 'LOGO_DND',
      schema: 'dbo',
      sourceKind: 'VIEW',
      qualifiedName: '[LOGO_DND].[dbo].[L_223_ODEME_PLANI]',
      columns: [{ name: 'VADE', kind: 'date' }],
    });
    const [statement, parameters] = query.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(statement).toContain('[LOGO_DND].[sys].[views]');
    expect(statement).not.toContain('Crm_DND');
    expect(parameters).toEqual({
      schema: 'dbo',
      viewName: 'L_223_ODEME_PLANI',
    });
    expect(() => assertReadOnlyLogoQuery(statement)).not.toThrow();
    await catalog.requireView('L_223_ODEME_PLANI');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each([
    'CRMFATURAVADERAPOROP',
    'LG_223_01_PAYTRANS',
    'L_223_ODEME_PLANI_KDV',
    'x]; DROP TABLE x',
  ])('rejects unregistered source %s before SQL', async (name) => {
    await expect(catalog.requireView(name)).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_NOT_ALLOWED' },
    });
    expect(query).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [{ ...metadata, databaseName: 'AnotherDatabase' }],
      [{ ...metadata, viewName: null, columnName: null }],
      [{ ...metadata, schemaName: 'other' }],
    ].map((rows) => ({ rows })),
  )(
    'rejects missing views, wrong connections and same-named non-view objects: %s',
    async ({ rows }) => {
      query.mockResolvedValue(rows);
      await expect(
        catalog.requireView('L_223_ODEME_PLANI'),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_SCHEMA_CHANGED' },
      });
    },
  );
});
