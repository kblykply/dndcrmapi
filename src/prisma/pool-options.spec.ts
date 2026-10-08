import { poolOptions, transactionOptions } from './pool-options';
describe('Database connection budgets', () => {
  it("waits longer than the connection timeout instead of Prisma's 2s default", () => {
    const env = { PG_CONNECTION_TIMEOUT_MS: '20000', PG_POOL_MAX: '2' };
    expect(transactionOptions(env).maxWait).toBeGreaterThan(
      poolOptions(env).connectionTimeoutMillis,
    );
    expect(poolOptions(env).max).toBe(2);
  });
  it('clamps invalid pool settings and maintains min <= max', () => {
    expect(
      poolOptions({ PG_POOL_MAX: 'bad', PG_POOL_MIN: '100' }),
    ).toMatchObject({ max: 2, min: 2 });
    expect(poolOptions({ PG_POOL_MAX: '-1', PG_POOL_MIN: '-1' })).toMatchObject(
      { max: 1, min: 0 },
    );
    expect(
      transactionOptions({
        PRISMA_MAX_WAIT_MS: '1',
        PG_CONNECTION_TIMEOUT_MS: '60000',
      }).maxWait,
    ).toBeGreaterThan(60000);
  });
});
