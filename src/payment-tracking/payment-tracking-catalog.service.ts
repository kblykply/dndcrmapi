import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LogoDatabaseService } from '../logo-database/logo-database.service';

export const PAYMENT_DATABASE = 'LOGO_DND';
export const PAYMENT_PLAN_VIEW = 'L_223_ODEME_PLANI';
export const PAYMENT_ATTRIBUTE_VIEW = 'L_223_FATURA_VADE';
export const PAYMENT_CONTACT_VIEW = 'L_223_OZET_SATIS';
const ALLOWED_VIEWS = [
  PAYMENT_PLAN_VIEW,
  PAYMENT_ATTRIBUTE_VIEW,
  PAYMENT_CONTACT_VIEW,
] as const;

export interface PaymentViewMetadata {
  database: string;
  schema: string;
  name: string;
  sourceKind: 'VIEW';
  qualifiedName: string;
  available: boolean;
  columns: Array<{
    name: string;
    kind: 'text' | 'number' | 'date' | 'unknown';
  }>;
}
interface MetadataRow extends Record<string, unknown> {
  databaseName: string;
  schemaName: string | null;
  viewName: string | null;
  columnName: string | null;
  dataType: string | null;
}
const NUMBER_TYPES = new Set([
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'decimal',
  'numeric',
  'float',
  'real',
  'money',
  'smallmoney',
]);
const TEXT_TYPES = new Set(['varchar', 'nvarchar', 'char', 'nchar']);
const DATE_TYPES = new Set(['date', 'datetime', 'datetime2', 'smalldatetime']);

/** Only the three tracking sources; independent of the retired reporting modules. */
@Injectable()
export class PaymentTrackingCatalogService {
  constructor(private readonly database: LogoDatabaseService) {}

  async requireView(name: string): Promise<PaymentViewMetadata> {
    if (!ALLOWED_VIEWS.some((allowed) => allowed === name)) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_TRACKING_SOURCE_NOT_ALLOWED',
        message: 'Takip kaynağı izin verilen Logo görünümleri arasında değil.',
      });
    }
    // sys.views excludes a same-named table or synonym. Revalidate on every source read.
    const rows = await this.database.query<MetadataRow>(
      `SELECT [connection].[databaseName], [metadata].*
       FROM (SELECT DB_NAME() AS [databaseName]) AS [connection]
       LEFT JOIN (
         SELECT [s].[name] AS [schemaName], [v].[name] AS [viewName],
           [c].[name] AS [columnName], [t].[name] AS [dataType]
         FROM [LOGO_DND].[sys].[views] AS [v]
         JOIN [LOGO_DND].[sys].[schemas] AS [s] ON [s].[schema_id]=[v].[schema_id]
         JOIN [LOGO_DND].[sys].[columns] AS [c] ON [c].[object_id]=[v].[object_id]
         JOIN [LOGO_DND].[sys].[types] AS [t] ON [t].[user_type_id]=[c].[user_type_id]
         WHERE [s].[name]=@schema AND [v].[name]=@viewName
       ) AS [metadata] ON 1=1`,
      { schema: 'dbo', viewName: name },
    );
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.databaseName !== PAYMENT_DATABASE ||
          row.schemaName !== 'dbo' ||
          row.viewName !== name ||
          !row.columnName ||
          !row.dataType,
      )
    ) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_TRACKING_SOURCE_SCHEMA_CHANGED',
        message: 'LOGO_DND takip görünümü ve kolonları doğrulanamadı.',
      });
    }
    return {
      database: PAYMENT_DATABASE,
      schema: 'dbo',
      name,
      sourceKind: 'VIEW',
      qualifiedName: `[LOGO_DND].[dbo].[${name}]`,
      available: true,
      columns: rows.map((row) => {
        const type = row.dataType!.toLowerCase();
        return {
          name: row.columnName!,
          kind: NUMBER_TYPES.has(type)
            ? 'number'
            : TEXT_TYPES.has(type)
              ? 'text'
              : DATE_TYPES.has(type)
                ? 'date'
                : 'unknown',
        };
      }),
    };
  }
}
