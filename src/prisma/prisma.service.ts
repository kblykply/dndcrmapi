import {
  Injectable,
  INestApplication,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { poolOptions, transactionOptions } from './pool-options';

const prismaPkg: any = require('@prisma/client');

@Injectable()
export class PrismaService
  extends prismaPkg.PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;
  private isShuttingDown = false;
  private statusTimer?: ReturnType<typeof setInterval>;

  constructor() {
    const caPath = path.join(process.cwd(), 'supabase-ca.crt');

    const ssl = fs.existsSync(caPath)
      ? {
          ca: fs.readFileSync(caPath, 'utf8'),
          rejectUnauthorized: true,
        }
      : {
          rejectUnauthorized: false,
        };

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      ...poolOptions(process.env),
      allowExitOnIdle: process.env.NODE_ENV === 'development',
    });

    pool.on('connect', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[PG POOL] client connected');
      }
    });

    pool.on('acquire', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[PG POOL] client acquired');
      }
    });

    pool.on('remove', () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[PG POOL] client removed');
      }
    });

    pool.on('error', (err) => {
      console.error('[PG POOL ERROR]', err);
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
      transactionOptions: transactionOptions(process.env),
      log:
        process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

    this.pool = pool;

    if (process.env.NODE_ENV === 'development') {
      this.statusTimer = setInterval(() => {
        console.log('[PG POOL STATUS]', {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount,
        });
      }, 10000);
      this.statusTimer.unref();
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      console.log('[Prisma] connected');
    } catch (error) {
      console.error('[Prisma] failed to connect on module init', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    if (this.statusTimer) clearInterval(this.statusTimer);

    try {
      await this.$disconnect();
    } catch (error) {
      console.error('[Prisma] disconnect error', error);
    }

    try {
      await this.pool.end();
    } catch (error) {
      console.error('[PG POOL] end error', error);
    }
  }

  enableShutdownHooks(app: INestApplication) {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;

      console.log(`[App] received ${signal}, shutting down...`);

      try {
        await this.onModuleDestroy();
      } finally {
        await app.close();
      }
    };

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });

    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  }
}
