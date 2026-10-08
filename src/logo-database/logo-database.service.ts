import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as sql from 'mssql';
import { LogoConfigService } from './logo-config.service';

export type LogoQueryValue = string | number | boolean | Date | null;
export type LogoQueryParameters = Record<string, LogoQueryValue>;

const WRITE_OR_EXECUTION_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|EXEC|EXECUTE|TRUNCATE|GRANT|REVOKE|DENY|DBCC|BACKUP|RESTORE|BULK|INTO|OPENROWSET|OPENDATASOURCE)\b/i;

export function assertReadOnlyLogoQuery(query: string): void {
  const normalized = query.trim();

  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error('Logo database only accepts SELECT queries');
  }
  if (normalized.includes(';') || /--|\/\*|\*\//.test(normalized)) {
    throw new Error(
      'Logo database query contains a forbidden statement separator or comment',
    );
  }
  if (WRITE_OR_EXECUTION_KEYWORDS.test(normalized)) {
    throw new Error('Logo database query contains a forbidden operation');
  }
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const candidate = error as { code?: unknown; name?: unknown };
  if (typeof candidate.code === 'string') return candidate.code.slice(0, 50);
  if (typeof candidate.name === 'string') return candidate.name.slice(0, 50);
  return 'UNKNOWN';
}

@Injectable()
export class LogoDatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(LogoDatabaseService.name);
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;

  constructor(private readonly logoConfig: LogoConfigService) {}

  async query<T extends Record<string, unknown>>(
    query: string,
    parameters: LogoQueryParameters = {},
  ): Promise<T[]> {
    assertReadOnlyLogoQuery(query);

    try {
      const pool = await this.getPool();
      const request = pool.request();

      for (const [name, value] of Object.entries(parameters)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw new Error('Logo query parameter name is invalid');
        }
        request.input(name, value);
      }

      const result = await request.query<T>(query);
      return result.recordset;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      const code = safeErrorCode(error);
      this.logger.warn(`Logo read failed (${code})`);
      await this.resetPool();
      throw new ServiceUnavailableException({
        code: 'LOGO_DB_UNAVAILABLE',
        message: 'Logo accounting database is temporarily unavailable',
      });
    }
  }

  async ping(): Promise<boolean> {
    const rows = await this.query<{ ok: number }>('SELECT 1 AS ok');
    return rows[0]?.ok === 1;
  }

  async onModuleDestroy(): Promise<void> {
    await this.resetPool();
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;

    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<sql.ConnectionPool> {
    const pool = new sql.ConnectionPool(this.logoConfig.getConnectionConfig());
    pool.on('error', (error) => {
      this.logger.warn(`Logo connection pool error (${safeErrorCode(error)})`);
    });

    try {
      this.pool = await pool.connect();
      return this.pool;
    } catch (error) {
      try {
        await pool.close();
      } catch {
        // The original connection error is the useful signal.
      }
      this.pool = null;
      throw error;
    }
  }

  private async resetPool(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (!pool) return;

    try {
      await pool.close();
    } catch {
      // Closing a broken read-only pool is best effort.
    }
  }
}
