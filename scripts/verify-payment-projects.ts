import 'reflect-metadata';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'dotenv';
import {
  PROJECT_LABELS,
  PROJECT_TYPES,
  type ProjectType,
} from '../src/common/projects';
import { LogoConfigService } from '../src/logo-database/logo-config.service';
import { LogoDatabaseService } from '../src/logo-database/logo-database.service';
import { PaymentTrackingCatalogService } from '../src/payment-tracking/payment-tracking-catalog.service';
import { PaymentTrackingSourceService } from '../src/payment-tracking/payment-tracking-source.service';
import { paymentList } from '../src/payment-tracking/payment-tracking.service';
import type {
  PaymentKindFilter,
  PaymentTrackingRow,
} from '../src/payment-tracking/payment-tracking.types';

// Independent source audit: production project classification helpers are not imported.
// Only aggregates, canonical labels and observed code/name families leave memory.
type ProjectGroup = ProjectType | 'UNKNOWN';
type RawRow = Record<string, unknown> & {
  customerCode: string | null;
  unitCode: string | null;
  unitName: string | null;
  projectCode: string | null;
  currency: string | null;
  records: number;
};
const codeProjects: Record<string, ProjectType> = {
  LJ: 'LA_JOYA',
  LJP: 'LA_JOYA_PERLA',
  LJP2: 'LA_JOYA_PERLA_II',
  LV: 'LAGOON_VERDE',
};
function normalized(value: string | null) {
  return value?.trim().toLocaleUpperCase('tr-TR') ?? '';
}
function codeProject(value: string | null): ProjectGroup | null {
  const code = value?.trim().toUpperCase() ?? '';
  if (code.startsWith('GK-ARSA') && /^\d+$/.test(code.slice(7)))
    return 'GECITKALE_1_ETAP';
  const [prefix, ...units] = code.split('-');
  if (
    prefix === 'S' &&
    units.length > 0 &&
    units.every((unit) => /^[A-Z]\d+[A-Z]?$/.test(unit))
  )
    return 'UNKNOWN';
  return codeProjects[prefix] &&
    units.length > 0 &&
    units.every((unit) => /^[A-Z]\d+[A-Z]?$/.test(unit))
    ? codeProjects[prefix]
    : null;
}
function nameEvidence(value: string | null): string {
  const name = normalized(value);
  if (/^LA JOYA PERLA (?:2|II)(?:\s|$)/.test(name)) return 'LA_JOYA_PERLA_II';
  if (/^LA JOYA PERLA(?:\s|$)/.test(name)) return 'LA_JOYA_PERLA';
  if (/^LA JOYA(?:\s|$)/.test(name)) return 'LA_JOYA';
  if (/^LAGOON VERDE(?:\s|$)/.test(name)) return 'LAGOON_VERDE';
  if (/^LAGON VERDE(?:\s|$)/.test(name)) return 'LAGOON_VERDE_SPELLING_VARIANT';
  if (/^GEÇİTKALE ARSA(?:\s|$)/.test(name))
    return 'GECITKALE_LAND_WITHOUT_PHASE_LABEL';
  if (/^SOPOT(?:\s|$)/.test(name)) return 'SOPOT_NOT_IN_CANONICAL_PROJECTS';
  if (/ELEKTRİK DEPOZİTO/.test(name)) return 'ELECTRICITY_DEPOSIT';
  return 'OTHER_OR_EMPTY_NAME';
}
const pair = (customer: string | null, unit: string | null) =>
  JSON.stringify([customer, unit]);
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${name}`);
}
const moneyFields = ['amount', 'paid', 'outstanding', 'overdueAmount'] as const;
function sumKnown(values: Array<number | null>): number | null {
  if (!values.length) return 0;
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}
function sameMoney(actual: number | null, expected: number | null) {
  check(actual === null || Number.isFinite(actual), 'finite actual money');
  check(
    expected === null || Number.isFinite(expected),
    'finite expected money',
  );
  check(
    actual === null || expected === null
      ? actual === expected
      : Math.abs(actual - expected) <=
          Math.max(0.02, Math.abs(expected) * 1e-9),
    'financial totals and null semantics',
  );
}
const output = resolve(
  __dirname,
  '../../output/payment-project-filter-2026-10-02/source-audit.json',
);
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  mode: 'SELECT_ONLY_NO_WORKFLOW_DATABASE',
  source: 'LOGO_DND.dbo.L_223_ODEME_PLANI',
  identity:
    'Full exact customerCode + unitCode across all currencies and payment kinds',
  privacy:
    'No customer identities, unit identities, names of people or financial amounts are persisted',
};
function persist() {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}

async function main() {
  const settings = {
    ...parse(readFileSync(resolve(__dirname, '../.env'))),
    ...process.env,
  };
  const database = new LogoDatabaseService(
    new LogoConfigService(new ConfigService(settings)),
  );
  const source = new PaymentTrackingSourceService(
    database,
    new PaymentTrackingCatalogService(database),
  );
  const started = Date.now();
  let stage = 'source_read';
  try {
    const webRegistry = readFileSync(
      resolve(__dirname, '../../web/src/lib/projects.ts'),
      'utf8',
    );
    const registryBody = webRegistry.match(
      /export const PROJECTS = \[([\s\S]*?)\] as const;/,
    )?.[1];
    check(registryBody, 'frontend canonical registry is readable');
    const webProjects = [...registryBody.matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    );
    check(
      JSON.stringify(webProjects) === JSON.stringify(PROJECT_TYPES),
      'frontend/backend canonical project values agree',
    );
    report.canonicalRegistryAgreement = 'PASS';
    const snapshot = await source.snapshot(true);
    report.sourceReadMs = Date.now() - started;
    report.sourceRows = snapshot.recordCount;
    report.currencyCases = snapshot.cases.length;
    report.asOf = snapshot.asOf;
    stage = 'raw_project_evidence';
    const sqlStarted = Date.now();
    const raw = await database.query<RawRow>(
      `SELECT [CARİ KOD] AS [customerCode], [DAİRE] AS [unitCode], [DAİRE ADI] AS [unitName], [PROJE KOD] AS [projectCode], [DVZ] AS [currency], COUNT(*) AS [records]
       FROM [LOGO_DND].[dbo].[L_223_ODEME_PLANI]
       GROUP BY [CARİ KOD], CONVERT(varbinary(max), [CARİ KOD]), [DAİRE], CONVERT(varbinary(max), [DAİRE]), [DAİRE ADI], CONVERT(varbinary(max), [DAİRE ADI]), [PROJE KOD], CONVERT(varbinary(max), [PROJE KOD]), [DVZ], CONVERT(varbinary(max), [DVZ])`,
    );
    report.rawEvidenceReadMs = Date.now() - sqlStarted;
    check(
      raw.reduce((sum, row) => sum + row.records, 0) === snapshot.recordCount,
      'raw source rows',
    );
    const grouped = new Map<
      string,
      { rows: RawRow[]; candidates: Set<ProjectGroup> }
    >();
    for (const row of raw) {
      const key = pair(row.customerCode, row.unitCode);
      const group = grouped.get(key) ?? {
        rows: [],
        candidates: new Set<ProjectGroup>(),
      };
      group.rows.push(row);
      for (const candidate of [
        codeProject(row.unitCode),
        codeProject(row.projectCode),
      ])
        if (candidate) group.candidates.add(candidate);
      grouped.set(key, group);
    }
    const oracle = new Map<string, ProjectGroup>();
    for (const [key, value] of grouped) {
      const unitProject = codeProject(value.rows[0].unitCode);
      const conflict = value.rows.some((row) => {
        const project = codeProject(row.projectCode);
        return project !== null && project !== unitProject;
      });
      oracle.set(
        key,
        unitProject && unitProject !== 'UNKNOWN' && !conflict
          ? unitProject
          : 'UNKNOWN',
      );
    }
    report.exactCustomerUnitGroups = grouped.size;
    report.conflictingCanonicalGroups = [...grouped.values()].filter(
      (group) => group.candidates.size > 1,
    ).length;
    report.missingUnitWithKnownProjectRows = raw
      .filter(
        (row) => !codeProject(row.unitCode) && codeProject(row.projectCode),
      )
      .reduce((sum, row) => sum + row.records, 0);
    report.canonicalProjects = PROJECT_TYPES.map((value) => ({
      value,
      label: PROJECT_LABELS[value],
    }));
    report.sourceNameCodeConflictRows = raw
      .filter((row) => {
        const unitProject = codeProject(row.unitCode);
        const sourceName = nameEvidence(row.unitName);
        const nameProject =
          sourceName === 'LAGOON_VERDE_SPELLING_VARIANT'
            ? 'LAGOON_VERDE'
            : sourceName === 'GECITKALE_LAND_WITHOUT_PHASE_LABEL'
              ? 'GECITKALE_1_ETAP'
              : sourceName;
        return (
          unitProject &&
          PROJECT_TYPES.some((value) => value === nameProject) &&
          unitProject !== nameProject
        );
      })
      .reduce((sum, row) => sum + row.records, 0);
    report.mapping = [
      { unitFamily: 'LJ-*', project: 'LA_JOYA', sourceNameFamily: 'LA JOYA' },
      {
        unitFamily: 'LJP-*',
        project: 'LA_JOYA_PERLA',
        sourceNameFamily: 'LA JOYA PERLA',
      },
      {
        unitFamily: 'LJP2-*',
        project: 'LA_JOYA_PERLA_II',
        sourceNameFamily: 'LA JOYA PERLA 2',
      },
      {
        unitFamily: 'LV-*',
        project: 'LAGOON_VERDE',
        sourceNameFamily: 'LAGOON VERDE / LAGON VERDE',
      },
      {
        unitFamily: 'GK-ARSA<number>',
        project: 'GECITKALE_1_ETAP',
        sourceNameFamily: 'GEÇİTKALE ARSA NO',
        caveat:
          'The source name does not encode phase 1; this uses the sole canonical Geçitkale project.',
      },
      {
        unitFamily: 'S-*',
        project: 'UNKNOWN',
        sourceNameFamily: 'SOPOT / SOPOT DENEME',
        reason: 'Sopot is not a registered canonical project.',
      },
    ];
    const evidence = new Map<
      string,
      {
        sourceRows: number;
        pairs: Set<string>;
        units: Set<string>;
        names: Map<string, number>;
      }
    >();
    const generic = new Map<
      string,
      {
        sourceRows: number;
        canonicalRows: number;
        unknownRows: number;
        unitProjects: Set<string>;
      }
    >();
    for (const row of raw) {
      const code = normalized(row.unitCode);
      const rawFamily = code.startsWith('GK-ARSA')
        ? 'GK-ARSA'
        : code.split('-')[0] || 'EMPTY';
      const family = [
        'LJ',
        'LJP',
        'LJP2',
        'LV',
        'GK-ARSA',
        'S',
        'DEPOZİTO',
        'ŞANTİYE',
        'EMPTY',
      ].includes(rawFamily)
        ? rawFamily
        : 'OTHER';
      const value = evidence.get(family) ?? {
        sourceRows: 0,
        pairs: new Set<string>(),
        units: new Set<string>(),
        names: new Map<string, number>(),
      };
      value.sourceRows += row.records;
      value.pairs.add(pair(row.customerCode, row.unitCode));
      value.units.add(row.unitCode ?? '');
      const nameFamily = nameEvidence(row.unitName);
      value.names.set(
        nameFamily,
        (value.names.get(nameFamily) ?? 0) + row.records,
      );
      evidence.set(family, value);
      const project = normalized(row.projectCode);
      if (
        [
          'KDV',
          'TRAFO',
          'ESYA',
          'EŞYA',
          'DEPOZİTO ELEKTRİK',
          'DEPOZITO ELEKTRIK',
        ].includes(project)
      ) {
        const counter = generic.get(project) ?? {
          sourceRows: 0,
          canonicalRows: 0,
          unknownRows: 0,
          unitProjects: new Set<string>(),
        };
        counter.sourceRows += row.records;
        const resolved = oracle.get(pair(row.customerCode, row.unitCode))!;
        if (resolved === 'UNKNOWN') counter.unknownRows += row.records;
        else counter.canonicalRows += row.records;
        counter.unitProjects.add(resolved);
        generic.set(project, counter);
      }
    }
    report.unitFamilyEvidence = [...evidence].map(([unitFamily, value]) => ({
      unitFamily,
      sourceRows: value.sourceRows,
      exactGroups: value.pairs.size,
      distinctUnits: value.units.size,
      sourceNameFamilies: [...value.names].map(([nameFamily, sourceRows]) => ({
        nameFamily,
        sourceRows,
      })),
    }));
    report.genericPaymentProjectEvidence = [...generic].map(
      ([paymentProjectCode, value]) => ({
        paymentProjectCode,
        sourceRows: value.sourceRows,
        canonicalRows: value.canonicalRows,
        unknownRows: value.unknownRows,
        unitProjects: [...value.unitProjects].sort(),
      }),
    );
    const projects: ProjectGroup[] = [...PROJECT_TYPES, 'UNKNOWN'];
    report.groupAssignments = projects.map((projectGroup) => {
      const groups = [...grouped].filter(
        ([key]) => oracle.get(key) === projectGroup,
      );
      return {
        projectGroup,
        exactGroups: groups.length,
        sourceRows: groups.reduce(
          (sum, [, value]) =>
            sum + value.rows.reduce((n, row) => n + row.records, 0),
          0,
        ),
      };
    });

    stage = 'production_partition';
    const actor = { id: 'read-only-project-verifier', role: 'ADMIN' };
    const currencies = [
      ...new Set(snapshot.cases.map((item) => item.identity.currency)),
    ];
    const kinds: PaymentKindFilter[] = [
      'all',
      'sale',
      'land',
      'vat',
      'transformer',
      'furniture',
      'deposit',
      'other',
    ];
    const checks: Array<Record<string, unknown>> = [];
    const completeList = (query: Record<string, unknown>) => {
      const first = paymentList(snapshot, [], actor, query);
      const rows: PaymentTrackingRow[] = [...first.rows];
      for (let page = 2; page <= first.totalPages; page++)
        rows.push(...paymentList(snapshot, [], actor, { ...query, page }).rows);
      check(rows.length === first.total, 'complete pagination');
      return { first, rows };
    };
    for (const currency of currencies)
      for (const paymentKind of kinds) {
        const baseQuery = {
          currency: currency ?? '__NULL__',
          paymentKind,
          scope: 'all',
          pageSize: 100,
        };
        const base = completeList(baseQuery);
        const partition: PaymentTrackingRow[] = [];
        for (const projectGroup of projects) {
          const expected = base.rows.filter(
            (row) =>
              oracle.get(
                pair(row.identity.customerCode, row.identity.unitCode),
              ) === projectGroup,
          );
          const actual = completeList({ ...baseQuery, projectGroup });
          const keys = new Set(expected.map((row) => row.key));
          check(
            actual.rows.length === keys.size &&
              actual.rows.every((row) => keys.has(row.key)),
            'project/currency/kind identity intersection',
          );
          check(
            actual.rows.every((row) => row.projectGroup === projectGroup),
            'project label on rows',
          );
          const option = base.first.projectGroups.find(
            (entry) => entry.value === projectGroup,
          );
          check(
            option?.caseCount === expected.length,
            'project option count after currency and payment kind',
          );
          check(
            actual.first.selectedProjectGroup === projectGroup,
            'selected project response',
          );
          for (const field of moneyFields)
            sameMoney(
              sumKnown(actual.rows.map((row) => row[field])),
              sumKnown(expected.map((row) => row[field])),
            );
          sameMoney(
            actual.first.filteredSummary.outstanding,
            sumKnown(expected.map((row) => row.outstanding)),
          );
          sameMoney(
            actual.first.filteredSummary.overdueAmount,
            sumKnown(expected.map((row) => row.overdueAmount)),
          );
          partition.push(...actual.rows);
          checks.push({
            currency,
            paymentKind,
            projectGroup,
            cases: actual.rows.length,
            sourceRows: actual.rows.reduce(
              (sum, row) => sum + row.installmentCount,
              0,
            ),
            status: 'PASS',
          });
        }
        check(
          partition.length === base.rows.length &&
            new Set(partition.map((row) => row.key)).size === base.rows.length,
          'project groups are an exclusive exhaustive case partition',
        );
        for (const field of moneyFields)
          sameMoney(
            sumKnown(partition.map((row) => row[field])),
            sumKnown(base.rows.map((row) => row[field])),
          );
      }
    report.productionChecks = checks;
    report.productionIntersectionChecks = checks.length;
    report.productionPartition = 'PASS';
    report.sourceNamesUsedForIdentity = false;
    report.status = 'PASS';
    report.totalMs = Date.now() - started;
    report.completedAt = new Date().toISOString();
    persist();
    console.log(
      JSON.stringify({
        status: report.status,
        sourceRows: report.sourceRows,
        currencyCases: report.currencyCases,
        exactGroups: report.exactCustomerUnitGroups,
        productionChecks: checks.length,
        totalMs: report.totalMs,
        output,
      }),
    );
  } catch (error) {
    report.status = 'FAIL';
    report.failedStage = stage;
    if (
      error instanceof Error &&
      error.message.startsWith('Verification failed:')
    )
      report.failedCheck = error.message;
    report.totalMs = Date.now() - started;
    persist();
    console.error(
      JSON.stringify({
        status: 'FAIL',
        stage,
        failedCheck: report.failedCheck,
        output,
      }),
    );
    process.exitCode = 1;
  } finally {
    source.onModuleDestroy();
    await database.onModuleDestroy();
  }
}

void main();
