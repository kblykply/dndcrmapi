import { paymentKindForProject } from './payment-tracking-kind';

describe('Logo payment line classification', () => {
  it.each([
    ['TRAFO', 'transformer'],
    ['KDV', 'vat'],
    ['ESYA', 'furniture'],
    ['EŞYA', 'furniture'],
    ['DEPOZİTO ELEKTRİK', 'deposit'],
    ['DEPOZITO ELEKTRIK', 'deposit'],
    ['GK-ARSA1', 'land'],
    ['GK-ARSA36', 'land'],
    ['LJ-A1', 'sale'],
    ['LJP-E12', 'sale'],
    ['LJP2-A21', 'sale'],
    ['LV-M23', 'sale'],
    ['S-D255', 'sale'],
    ['LJ-A15A', 'sale'],
    ['LJP-G1-G2-G3-G4', 'sale'],
    ['LJP-G14-G15', 'sale'],
    ['  trafo  ', 'transformer'],
    ['kdv', 'vat'],
    ['eşya', 'furniture'],
    ['depozito elektrik', 'deposit'],
    ['ljp-e12', 'sale'],
  ])('classifies verified project code %s as %s', (code, expected) => {
    expect(paymentKindForProject(code)).toBe(expected);
  });

  it.each([
    null,
    '',
    ' ',
    'MO',
    'LJ',
    'ARAZİ',
    'ARSA',
    'GK-ARSA',
    'GK-ARSA1-UNKNOWN',
    'LV-',
    'LV-TRAFO',
    'LV-ARSA1',
    'OTHER-A1',
    'LJP-A1-TRAFO',
    'VAT',
    'KDV EXTRA',
  ])(
    'keeps new or ambiguous code %s under Other instead of normal sales',
    (code) => {
      expect(paymentKindForProject(code)).toBe('other');
    },
  );
});
