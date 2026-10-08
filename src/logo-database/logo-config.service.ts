import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { config as SqlConfig } from 'mssql';

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseIntegerList(value: string | undefined): number[] {
  if (!value?.trim()) return [];

  return Array.from(
    new Set(
      value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((part) => Number.isInteger(part) && part > 0),
    ),
  );
}

function parsePrefixList(
  value: string | undefined,
  fallback: string[],
): string[] {
  const prefixes = (value || '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));

  return prefixes.length ? Array.from(new Set(prefixes)) : fallback;
}

@Injectable()
export class LogoConfigService {
  constructor(private readonly config: ConfigService) {}

  get firms(): number[] {
    return parseIntegerList(this.config.get<string>('LOGO_FIRMS'));
  }

  get periodNo(): number {
    return parsePositiveInteger(this.config.get<string>('LOGO_PERIOD_NO'), 1);
  }

  get schema(): string {
    const schema = this.config.get<string>('LOGO_DB_SCHEMA')?.trim() || 'dbo';
    if (!SAFE_IDENTIFIER.test(schema)) {
      throw new ServiceUnavailableException({
        code: 'LOGO_CONFIG_INVALID',
        message: 'Logo database schema is invalid',
      });
    }
    return schema;
  }

  get overlapHours(): number {
    return parsePositiveInteger(
      this.config.get<string>('LOGO_SYNC_OVERLAP_HOURS'),
      24,
    );
  }

  get incomeAccountPrefixes(): string[] {
    return parsePrefixList(this.config.get<string>('LOGO_GL_INCOME_PREFIXES'), [
      '600',
      '601',
      '602',
      '64',
      '67',
    ]);
  }

  get expenseAccountPrefixes(): string[] {
    return parsePrefixList(
      this.config.get<string>('LOGO_GL_EXPENSE_PREFIXES'),
      ['62', '63', '65', '66', '7'],
    );
  }

  get isDatabaseConfigured(): boolean {
    return Boolean(
      this.config.get<string>('LOGO_DB_HOST')?.trim() &&
      this.config.get<string>('LOGO_DB_NAME')?.trim() &&
      this.config.get<string>('LOGO_DB_USER')?.trim() &&
      this.config.get<string>('LOGO_DB_PASSWORD') &&
      this.firms.length,
    );
  }

  getConnectionConfig(): SqlConfig {
    const host = this.config.get<string>('LOGO_DB_HOST')?.trim();
    const database = this.config.get<string>('LOGO_DB_NAME')?.trim();
    const user = this.config.get<string>('LOGO_DB_USER')?.trim();
    const password = this.config.get<string>('LOGO_DB_PASSWORD');

    if (!host || !database || !user || !password || !this.firms.length) {
      throw new ServiceUnavailableException({
        code: 'LOGO_CONFIG_MISSING',
        message: 'Logo database configuration is incomplete',
      });
    }

    return {
      server: host,
      port: parsePositiveInteger(this.config.get<string>('LOGO_DB_PORT'), 1433),
      database,
      user,
      password,
      connectionTimeout: parsePositiveInteger(
        this.config.get<string>('LOGO_DB_CONNECTION_TIMEOUT_MS'),
        10_000,
      ),
      requestTimeout: parsePositiveInteger(
        this.config.get<string>('LOGO_DB_REQUEST_TIMEOUT_MS'),
        30_000,
      ),
      pool: {
        min: 0,
        max: 2,
        // Keep the two read connections between the tracking cache's idle refreshes.
        idleTimeoutMillis: parsePositiveInteger(
          this.config.get<string>('LOGO_DB_IDLE_TIMEOUT_MS'),
          180_000,
        ),
      },
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
    };
  }

  publicConfiguration() {
    return {
      configured: this.isDatabaseConfigured,
      firms: this.firms,
      periodNo: this.periodNo,
      schema: this.schema,
      syncMode: 'MANUAL' as const,
      automaticSyncEnabled: false,
      storage: 'IN_MEMORY' as const,
      sourceMode: 'READ_ONLY' as const,
    };
  }
}
