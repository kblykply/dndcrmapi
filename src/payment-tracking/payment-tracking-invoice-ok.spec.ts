import { BadRequestException } from '@nestjs/common';
import {
  invoiceOkFilterOptions,
  invoiceOkToken,
  matchesInvoiceOk,
  parseInvoiceOkFilter,
} from './payment-tracking-invoice-ok';
import type { PaymentInvoiceOk } from './payment-tracking.types';

const field = (values: string[], hasBlank = false): PaymentInvoiceOk => ({
  status: 'matched',
  values,
  hasBlank,
});

describe('Fatura OK whole-case classification', () => {
  it.each([undefined, null, '', 'all'])('defaults to all for %s', (input) => {
    expect(parseInvoiceOkFilter(input)).toBe('all');
  });
  it.each([
    'value:DND',
    'value:GÜL',
    'value:KOZANSOY',
    'value:DND ',
    'blank',
    'mixed',
    'unknown',
  ])('accepts exact codes and supported states: %s', (input) => {
    expect(parseInvoiceOkFilter(input)).toBe(input);
  });
  it.each([
    ['all'],
    {},
    0,
    true,
    'DND',
    'no',
    'value:',
    'value: ',
    'value:DND\n',
    `value:${'x'.repeat(251)}`,
  ])('rejects invalid filters: %s', (input) => {
    expect(() => parseInvoiceOkFilter(input)).toThrow(BadRequestException);
  });
  it('keeps mixed codes and code-plus-blank separate from any single-code balance', () => {
    const mixed = { invoiceOk: field(['DND', 'KOZANSOY']) };
    const withBlank = { invoiceOk: field(['DND'], true) };
    for (const item of [mixed, withBlank]) {
      expect(invoiceOkToken(item)).toBe('mixed');
      expect(matchesInvoiceOk(item, 'value:DND')).toBe(false);
      expect(matchesInvoiceOk(item, 'blank')).toBe(false);
      expect(matchesInvoiceOk(item, 'mixed')).toBe(true);
      expect(matchesInvoiceOk(item, 'all')).toBe(true);
    }
  });
  it('separates blank, unmatched and unavailable, and preserves exact text distinctions', () => {
    expect(invoiceOkToken({ invoiceOk: field([], true) })).toBe('blank');
    for (const status of ['unmatched', 'unavailable'] as const)
      expect(
        invoiceOkToken({ invoiceOk: { status, values: [], hasBlank: false } }),
      ).toBe('unknown');
    expect(invoiceOkToken({})).toBe('unknown');
    expect(invoiceOkToken({ invoiceOk: field(['DND', 'dnd']) })).toBe('mixed');
    expect(invoiceOkToken({ invoiceOk: field(['DND', 'DND ']) })).toBe('mixed');
    expect(matchesInvoiceOk({ invoiceOk: field(['DND ']) }, 'value:DND')).toBe(
      false,
    );
  });
  it('partitions option counts exactly once and treats source words like blank as codes', () => {
    const cases = [
      { invoiceOk: field(['DND']) },
      { invoiceOk: field(['DND', 'KOZANSOY']) },
      { invoiceOk: field([], true) },
      { invoiceOk: field(['blank']) },
      {},
    ];
    const options = invoiceOkFilterOptions(cases);
    expect(options.reduce((sum, option) => sum + option.caseCount, 0)).toBe(
      cases.length,
    );
    expect(options).toContainEqual({
      value: 'value:KOZANSOY',
      label: 'KOZANSOY',
      caseCount: 0,
    });
    expect(options).toContainEqual({
      value: 'value:blank',
      label: 'blank',
      caseCount: 1,
    });
  });
});
