function numberInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.floor(parsed)))
    : fallback;
}

export function poolOptions(env: NodeJS.ProcessEnv) {
  const max = numberInRange(env.PG_POOL_MAX, 2, 1, 20);
  return {
    max,
    min: numberInRange(env.PG_POOL_MIN, 1, 0, max),
    idleTimeoutMillis: numberInRange(
      env.PG_IDLE_TIMEOUT_MS,
      60000,
      1000,
      300000,
    ),
    connectionTimeoutMillis: numberInRange(
      env.PG_CONNECTION_TIMEOUT_MS,
      20000,
      5000,
      60000,
    ),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };
}

export function transactionOptions(env: NodeJS.ProcessEnv) {
  // Prisma's 2s default can expire before a remote Postgres pool establishes a connection.
  return {
    maxWait: Math.max(
      poolOptions(env).connectionTimeoutMillis + 5000,
      numberInRange(env.PRISMA_MAX_WAIT_MS, 30000, 5000, 90000),
    ),
    timeout: numberInRange(
      env.PRISMA_TRANSACTION_TIMEOUT_MS,
      30000,
      5000,
      90000,
    ),
  };
}
