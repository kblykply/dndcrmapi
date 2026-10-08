import { databaseFailure } from './database-exception.filter';
describe('Database errors', () => {
  it.each([
    'P1001',
    'P1002',
    'P1008',
    'P1017',
    'P2024',
    'P2037',
    'ETIMEDOUT',
    'ECONNRESET',
    '53300',
  ])('classifies %s as temporary without exposing SQL', (code) => {
    const result = databaseFailure({ code, message: 'SECRET SQL' });
    expect(result?.status).toBe(503);
    expect(result?.message).not.toContain('SECRET');
  });
  it('recognizes the reproduced transaction startup timeout', () => {
    expect(
      databaseFailure({
        code: 'P2028',
        message: 'Unable to start a transaction in the given time',
      })?.status,
    ).toBe(503);
  });
  it.each([
    ['P2002', 409],
    ['P2025', 404],
    ['P2003', 409],
    ['P2034', 409],
  ])('maps %s', (code, status) =>
    expect(databaseFailure({ code })?.status).toBe(status),
  );
  it('does not hide programming or schema errors as a retryable outage', () => {
    expect(databaseFailure({ code: 'P2022' })).toBeNull();
    expect(databaseFailure(new TypeError('bad code'))).toBeNull();
  });
});
