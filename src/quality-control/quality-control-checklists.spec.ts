import {
  DEFAULT_QUALITY_CHECKLISTS,
  defaultQualityChecklistId,
} from './quality-control-checklists';

const EXPECTED_CARD_CODES = [
  '4.1',
  '4.2',
  '4.3',
  '4.4',
  '5',
  '6',
  '6.1',
  '6.2',
  '6.3',
  '7',
  '7.1',
  '7.2',
  '7.3',
  '7.4',
  '7.5',
  '8',
  '8.1',
  '8.2',
  '8.3',
  '8.4',
  '8.5',
  '8.6',
  '8.7',
  '9',
  '9.1',
  '9.2',
  '9.3',
  '10',
  '10.1',
  '10.2',
  '10.3',
  'İNŞAAT',
  'SATIŞ',
].sort();

describe('quality control default checklists', () => {
  it('covers every default quality card with a substantive checklist', () => {
    expect(Object.keys(DEFAULT_QUALITY_CHECKLISTS).sort()).toEqual(
      EXPECTED_CARD_CODES,
    );

    for (const items of Object.values(DEFAULT_QUALITY_CHECKLISTS)) {
      expect(items.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('has stable unique ids and complete content', () => {
    const ids: string[] = [];

    for (const [cardCode, items] of Object.entries(
      DEFAULT_QUALITY_CHECKLISTS,
    )) {
      expect(new Set(items.map((item) => item.key)).size).toBe(items.length);

      for (const item of items) {
        expect(item.title.trim().length).toBeGreaterThan(10);
        expect(item.description.trim().length).toBeGreaterThan(30);
        ids.push(defaultQualityChecklistId(cardCode, item.key));
      }
    }

    expect(new Set(ids).size).toBe(ids.length);
  });
});
