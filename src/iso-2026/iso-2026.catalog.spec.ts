import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { Iso2026Source, clauseMetadata } from './iso-2026.catalog';

describe('ISO 2026 installed source catalog', () => {
  it('loads the actual source with unique codes, valid hierarchy and physical PDF page references', () => {
    const source = new Iso2026Source();
    const { clauses, document } = source.data();
    const codes = new Set(clauses.map((row) => row.code));
    expect(clauses.length).toBeGreaterThan(0);
    expect(codes.size).toBe(clauses.length);
    for (const row of clauses) {
      expect(typeof row.body).toBe('string');
      expect(typeof row.titleTr).toBe('string');
      expect(row.parentCode === null || codes.has(row.parentCode)).toBe(true);
      expect(row.sourcePages.length).toBeGreaterThan(0);
      expect(row.sourcePages.every((page) => Number.isInteger(page) && page >= 1 && page <= document.totalPages)).toBe(true);
      expect(clauseMetadata(row)).not.toHaveProperty('body');
    }
    for (const code of ['foreword', '0', '4.1', 'A', 'bibliography']) expect(source.clause(code).code).toBe(code);
    expect(() => source.clause('../source')).toThrow(NotFoundException);
  });
  it('matches the installed private PDF to the catalog provenance hash', () => {
    const source = new Iso2026Source();
    const pdf = readFileSync(join(process.cwd(), 'project-documents', 'iso-2026', 'ISO_9001_2026.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(source.data().document.sha256);
  });
});
