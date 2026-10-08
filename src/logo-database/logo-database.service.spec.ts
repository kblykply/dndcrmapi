import { assertReadOnlyLogoQuery } from './logo-database.service';

describe('assertReadOnlyLogoQuery', () => {
  it.each([
    'SELECT 1 AS ok',
    '  select TOP 1 * FROM LG_223_CLCARD WITH (NOLOCK)',
    'WITH rows AS (SELECT 1 AS value) SELECT value FROM rows',
  ])('accepts a single read query: %s', (query) => {
    expect(() => assertReadOnlyLogoQuery(query)).not.toThrow();
  });

  it.each([
    'INSERT INTO x VALUES (1)',
    'UPDATE x SET value = 1',
    'DELETE FROM x',
    'SELECT * INTO copied FROM source',
    'SELECT 1; SELECT 2',
    'SELECT 1 -- comment',
    'WITH rows AS (SELECT 1 AS value) DELETE FROM x',
    'EXEC sp_who',
  ])('rejects a write or ambiguous query: %s', (query) => {
    expect(() => assertReadOnlyLogoQuery(query)).toThrow();
  });
});
