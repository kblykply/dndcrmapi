import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type IsoClause = {
  code: string; title: string; titleTr: string | null; parentCode: string | null;
  kind: string; body: string; sourcePages: number[]; relatedCodes: string[]; titleIsEditorial?: boolean;
};
export type IsoDocument = {
  title: string; reference: string; status: string; language: string;
  sourceFile: string; totalPages: number; sha256: string;
};
export type IsoSourceData = { document: IsoDocument; clauses: IsoClause[] };
export function clauseMetadata({ body: _body, ...metadata }: IsoClause) { return metadata; }

@Injectable()
export class Iso2026Source {
  private cached?: IsoSourceData;
  data(): IsoSourceData {
    if (this.cached) return this.cached;
    const path = [join(__dirname, 'iso-2026-source.json'), join(process.cwd(), 'src', 'iso-2026', 'iso-2026-source.json')].find(existsSync);
    if (!path) throw new ServiceUnavailableException('ISO 2026 source document is not installed');
    const data = JSON.parse(readFileSync(path, 'utf8')) as IsoSourceData;
    if (!data.document || !Array.isArray(data.clauses) || new Set(data.clauses.map((c) => c.code)).size !== data.clauses.length) throw new ServiceUnavailableException('Invalid ISO 2026 source catalog');
    this.cached = data;
    return data;
  }
  clause(code: string): IsoClause {
    const clause = this.data().clauses.find((row) => row.code === code);
    if (!clause) throw new NotFoundException('ISO 2026 clause not found');
    return clause;
  }
}
