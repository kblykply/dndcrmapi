import { createHash } from 'node:crypto';
import type { LogoQueryParameters } from '../logo-database/logo-database.service';

export const CONTACT_SNAPSHOT_QUERY =
  'SELECT [CARİ KOD] AS [customerCode], [MAIL] AS [email], [TELEFON] AS [phone] FROM [LOGO_DND].[dbo].[L_223_OZET_SATIS]';
export function paymentSnapshotKey(
  query: string,
  parameters: LogoQueryParameters = {},
) {
  if (query.includes('FROM [LOGO_DND].[dbo].[L_223_OZET_SATIS]'))
    return 'contacts';
  return createHash('sha256')
    .update(
      JSON.stringify([
        query,
        Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest('hex');
}
