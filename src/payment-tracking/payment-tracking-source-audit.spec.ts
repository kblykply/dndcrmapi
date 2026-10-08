import { assertReadOnlyLogoQuery } from '../logo-database/logo-database.service';
import {
  PAYMENT_SOURCE_AUDIT_QUERY,
  readPaymentSourceAudit,
  sourceAuditIdentity,
} from './payment-tracking-source-audit';

function response(
  patch: Record<string, unknown> = {},
  reviews: unknown[] = [],
) {
  return {
    summary: JSON.stringify({
      paymentRows: 30,
      multipleStockLines: 0,
      multipleReceiptMatches: 0,
      cancelledInvoices: 0,
      cancelledStockLines: 0,
      invalidSigns: 0,
      invalidInvoiceLinks: 0,
      unknownCurrencies: 0,
      nullAmounts: 0,
      missingIdentities: 0,
      excludedVatRows: reviews.length,
      ...patch,
    }),
    reviews: JSON.stringify(reviews),
  };
}
function candidate(patch: Record<string, unknown> = {}) {
  return {
    customerCode: 'OLD',
    unitCode: 'LJ-A1',
    currency: 'GBP',
    selectedCustomerCode: 'NEW',
    selectedUnitCode: 'LJ-A1',
    selectedCurrency: 'GBP',
    excludedOutstanding: 17,
    hasCustomerChange: 1,
    hasReturnLink: 1,
    ...patch,
  };
}
function database(rows: unknown[] = [response()]) {
  return { query: jest.fn().mockResolvedValue(rows) };
}

describe('Payment source audit', () => {
  it('uses the shared read-only query guard', () => {
    expect(() =>
      assertReadOnlyLogoQuery(PAYMENT_SOURCE_AUDIT_QUERY),
    ).not.toThrow();
  });

  it('verifies empty or normal sources without inventing a VAT review', async () => {
    const result = await readPaymentSourceAudit(
      database([response({ paymentRows: 0 })]),
    );
    expect(result.paymentRows).toBe(0);
    expect(result.summary).toMatchObject({
      status: 'verified',
      financialChecks: 'passed',
      excludedVatRows: 0,
    });
    expect(result.reviews.size).toBe(0);
  });

  it.each([
    'multipleStockLines',
    'multipleReceiptMatches',
    'cancelledInvoices',
    'cancelledStockLines',
    'invalidSigns',
    'invalidInvoiceLinks',
    'unknownCurrencies',
    'nullAmounts',
    'missingIdentities',
  ])('fails closed when %s is present', async (field) => {
    await expect(
      readPaymentSourceAudit(database([response({ [field]: 1 })])),
    ).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID' },
    });
  });

  it.each(
    [
      [],
      [undefined],
      [response(), response()],
      [{ summary: '{}', reviews: '[]' }],
      [{ summary: 'null', reviews: '[]' }],
      [{ summary: '{bad}', reviews: '[]' }],
      [{ ...response(), reviews: '{}' }],
      [response({ excludedVatRows: 1 })],
      [response({ paymentRows: '30' })],
      [response({ nullAmounts: null })],
      [response({ cancelledInvoices: -1 })],
      [response({ excludedVatRows: 25_001 })],
    ].map((rows) => ({ rows })),
  )(
    'never passes an incomplete, truncated or malformed result: %j',
    async ({ rows }) => {
      await expect(
        readPaymentSourceAudit(database(rows)),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID' },
      });
    },
  );

  it('distinguishes unavailable verification from detected data corruption', async () => {
    const db = database();
    db.query.mockRejectedValue(new Error('Synthetic SQL timeout'));
    await expect(readPaymentSourceAudit(db)).rejects.toMatchObject({
      response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_UNAVAILABLE' },
    });
  });

  it('links review to old and selected exact identities while keeping currencies separate', async () => {
    const result = await readPaymentSourceAudit(
      database([
        response({}, [
          candidate(),
          candidate({
            currency: 'EUR',
            selectedCurrency: 'GBP',
            excludedOutstanding: 9,
          }),
        ]),
      ]),
    );
    const current = result.reviews.get(
      sourceAuditIdentity({
        customerCode: 'NEW',
        unitCode: 'LJ-A1',
        currency: 'GBP',
      }),
    );
    expect(current?.vat).toEqual([
      {
        currency: 'GBP',
        excludedRows: 1,
        excludedOutstanding: 17,
        hasReturnLink: true,
        hasCustomerChange: true,
      },
      {
        currency: 'EUR',
        excludedRows: 1,
        excludedOutstanding: 9,
        hasReturnLink: true,
        hasCustomerChange: true,
      },
    ]);
    expect(
      result.reviews.has(
        sourceAuditIdentity({
          customerCode: 'new',
          unitCode: 'LJ-A1',
          currency: 'GBP',
        }),
      ),
    ).toBe(false);
    expect(
      result.reviews.has(
        sourceAuditIdentity({
          customerCode: 'NEW ',
          unitCode: 'LJ-A1',
          currency: 'GBP',
        }),
      ),
    ).toBe(false);
    expect(result.summary.excludedVatRows).toBe(2);
  });

  it('does not duplicate a review when old and selected case identity is the same', async () => {
    const result = await readPaymentSourceAudit(
      database([
        response({}, [
          candidate({ customerCode: 'NEW', hasCustomerChange: 0 }),
          candidate({
            customerCode: 'NEW',
            hasCustomerChange: 0,
            excludedOutstanding: 4,
          }),
        ]),
      ]),
    );
    expect(result.reviews.size).toBe(1);
    expect([...result.reviews.values()][0].vat).toEqual([
      {
        currency: 'GBP',
        excludedRows: 2,
        excludedOutstanding: 21,
        hasReturnLink: true,
        hasCustomerChange: false,
      },
    ]);
  });

  it.each([
    { customerCode: null },
    { unitCode: '' },
    { selectedCustomerCode: ' ' },
    { currency: 'TANIMSIZ' },
    { selectedCurrency: 'CHF' },
    { excludedOutstanding: null },
    { excludedOutstanding: -5 },
    { excludedOutstanding: '17' },
    { hasReturnLink: null },
    { hasCustomerChange: 0 },
  ])(
    'does not label an unknown or mismatched review as verified: %j',
    async (patch) => {
      await expect(
        readPaymentSourceAudit(database([response({}, [candidate(patch)])])),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_TRACKING_SOURCE_AUDIT_INVALID' },
      });
    },
  );
});
