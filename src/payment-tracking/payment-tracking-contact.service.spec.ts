import { Logger } from '@nestjs/common';
import { PaymentTrackingContactService } from './payment-tracking-contact.service';
import type { PaymentContact, PaymentIdentity } from './payment-tracking.types';

const identity: PaymentIdentity = {
  customerCode: 'C-1',
  unitCode: 'LJP-A2',
  currency: 'GBP',
};
const empty: PaymentContact = {
  email: null,
  phone: null,
  status: 'missing',
  source: null,
};
const crmCustomer = () => ({
  oldCustomerCode: 'import-id',
  oldCariCodes: 'C-9 | C-1',
  email: 'crm@example.com',
  phone: '+905321234567',
  unitSelections: [{ project: 'LA_JOYA_PERLA', unitNumber: 'A-2' }],
});

function setup(rows = [crmCustomer()]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const service = new PaymentTrackingContactService({
    customer: { findMany },
  } as never);
  return { service, findMany };
}

describe('CRM contact enrichment without changing Logo', () => {
  it('fills both missing fields by exact legacy code and active unit, without mutating either source', async () => {
    const row = crmCustomer();
    const before = structuredClone(row);
    const { service, findMany } = setup([row]);
    const result = await service.complete(
      Object.freeze({ ...empty }),
      identity,
    );
    expect(result).toMatchObject({
      email: row.email,
      phone: row.phone,
      emailSource: 'crm',
      phoneSource: 'crm',
      status: 'matched',
    });
    expect(row).toEqual(before);
    expect(findMany.mock.calls).toMatchObject([
      [{ select: { unitSelections: { where: { isCanceled: false } } } }],
    ]);
  });

  it.each(['email', 'phone'] as const)(
    'preserves the existing Logo %s and fills only the other field',
    async (field) => {
      const { service } = setup();
      const logo = {
        ...empty,
        status: 'matched' as const,
        [field]: field === 'email' ? 'logo@example.com' : '+905551112233',
      };
      const result = await service.complete(logo, identity);
      expect(result[field]).toBe(logo[field]);
      expect(result[`${field}Source`]).toBe('logo');
      expect(result[field === 'email' ? 'phoneSource' : 'emailSource']).toBe(
        'crm',
      );
    },
  );

  it('uses updated CRM data on the next read and prioritizes populated Logo data after refresh', async () => {
    const { service, findMany } = setup();
    expect((await service.complete(empty, identity)).email).toBe(
      'crm@example.com',
    );
    findMany.mockResolvedValue([
      { ...crmCustomer(), email: 'updated@example.com' },
    ]);
    expect((await service.complete(empty, identity)).email).toBe(
      'updated@example.com',
    );
    const refreshed: PaymentContact = {
      ...empty,
      email: 'logo@example.com',
      phone: '+905551112233',
      status: 'matched',
    };
    expect(await service.complete(refreshed, identity)).toBe(refreshed);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it.each(['C-10', 'c-1', 'C-1-2'])(
    'rejects approximate code match %s',
    async (code) => {
      const { service } = setup([{ ...crmCustomer(), oldCariCodes: code }]);
      expect(await service.complete(empty, identity)).toEqual(empty);
    },
  );

  it('also accepts an exact oldCustomerCode, without an oldCariCodes entry', async () => {
    const { service } = setup([
      { ...crmCustomer(), oldCustomerCode: 'C-1', oldCariCodes: '' },
    ]);
    expect((await service.complete(empty, identity)).emailSource).toBe('crm');
  });

  it('does not choose between two customer records even when they share an email', async () => {
    const { service } = setup([crmCustomer(), crmCustomer()]);
    expect(await service.complete(empty, identity)).toEqual({
      ...empty,
      crmFallbackStatus: 'ambiguous',
    });
  });

  it.each([
    { units: [] },
    { units: [{ project: 'LA_JOYA', unitNumber: 'A2' }] },
    { units: [{ project: 'LA_JOYA_PERLA', unitNumber: 'A3' }] },
  ])(
    'withholds fallback when the active project/unit does not match: %j',
    async ({ units }) => {
      const { service } = setup([{ ...crmCustomer(), unitSelections: units }]);
      expect(await service.complete(empty, identity)).toEqual({
        ...empty,
        crmFallbackStatus: 'unit_mismatch',
      });
    },
  );

  it('requires every unit in a combined Logo account to match', async () => {
    const { service } = setup();
    expect(
      (await service.complete(empty, { ...identity, unitCode: 'LJP-A2-A3' }))
        .crmFallbackStatus,
    ).toBe('unit_mismatch');
  });

  it('accepts a single exact code for unrecognized unit formats without guessing a unit', async () => {
    const { service } = setup();
    expect(
      (await service.complete(empty, { ...identity, unitCode: 'CUSTOM-UNIT' }))
        .emailSource,
    ).toBe('crm');
  });

  it.each(['ambiguous', 'unavailable'] as const)(
    'does not mask an uncertain Logo result: %s',
    async (status) => {
      const { service, findMany } = setup();
      const logo = { ...empty, status };
      expect(await service.complete(logo, identity)).toBe(logo);
      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('treats dash placeholders as empty without altering the original contact', async () => {
    const { service } = setup();
    const logo = Object.freeze({
      ...empty,
      email: ' - ',
      phone: '—',
      status: 'matched' as const,
    });
    expect(await service.complete(logo, identity)).toMatchObject({
      emailSource: 'crm',
      phoneSource: 'crm',
    });
    expect(logo.phone).toBe('—');
  });

  it.each([
    ['a@example.com | b@example.com', '+905321234567 | +905551112233'],
    ['not-an-email', '0000000000'],
    ['-', '123'],
  ])(
    'does not insert invalid or multiple CRM contacts',
    async (email, phone) => {
      const { service } = setup([{ ...crmCustomer(), email, phone }]);
      expect(await service.complete(empty, identity)).toEqual(empty);
    },
  );

  it('keeps finance available when the CRM lookup fails', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const { service, findMany } = setup();
      findMany.mockRejectedValue(new Error('unavailable'));
      const logo = {
        ...empty,
        email: 'logo@example.com',
        status: 'matched' as const,
      };
      expect(await service.complete(logo, identity)).toEqual({
        ...logo,
        crmFallbackStatus: 'unavailable',
      });
    } finally {
      warning.mockRestore();
    }
  });

  it('does not search without a customer code', async () => {
    const { service, findMany } = setup();
    expect(
      await service.complete(empty, { ...identity, customerCode: null }),
    ).toEqual(empty);
    expect(findMany).not.toHaveBeenCalled();
  });
});
