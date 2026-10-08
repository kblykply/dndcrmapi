import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  LogoDatabaseService,
  type LogoQueryParameters,
} from '../logo-database/logo-database.service';
import { LogoConfigService } from '../logo-database/logo-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { paymentSnapshotKey } from './payment-snapshot-key';

/** A private, audited one-time read model. Never falls back to a live Logo connection. */
@Injectable()
export class PaymentSnapshotDatabaseService extends LogoDatabaseService {
  importedAt: string | null = null;
  constructor(
    config: LogoConfigService,
    private readonly prisma: PrismaService,
  ) {
    super(config);
  }

  override async query<T extends Record<string, unknown>>(
    query: string,
    parameters: LogoQueryParameters = {},
  ): Promise<T[]> {
    if (process.env.PAYMENT_SOURCE_MODE === 'logo')
      return super.query<T>(query, parameters);
    const key = paymentSnapshotKey(query, parameters);
    const rows = await this.prisma.$queryRaw<
      Array<{ payload: T[]; importedAt: Date }>
    >`
      SELECT d.payload, b."importedAt"
      FROM "PaymentSourceDataset" d JOIN "PaymentSourceBatch" b ON b.id = d."batchId"
      WHERE b.active = true AND d.key = ${key}`;
    if (rows.length !== 1 || !Array.isArray(rows[0].payload))
      throw new ServiceUnavailableException({
        code: 'PAYMENT_SNAPSHOT_UNAVAILABLE',
        message:
          'Finans kaynak aktarımı bulunamadı veya uygulama sürümüyle uyumlu değil.',
      });
    this.importedAt = rows[0].importedAt.toISOString();
    const data = rows[0].payload;
    return key === 'contacts' && parameters.customerCode !== undefined
      ? data
          .filter((row) => row.customerCode === parameters.customerCode)
          .slice(0, 101)
      : data;
  }
}
