import {
  Injectable,
  INestApplication,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";

const prismaPkg: any = require("@prisma/client");

@Injectable()
export class PrismaService
  extends prismaPkg.PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;
  private isShuttingDown = false;

  constructor() {
    const caPath = path.join(process.cwd(), "supabase-ca.crt");

    const ssl = fs.existsSync(caPath)
      ? {
          ca: fs.readFileSync(caPath, "utf8"),
          rejectUnauthorized: true,
        }
      : {
          rejectUnauthorized: false,
        };

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: Number(process.env.PG_POOL_MAX || 5),
      min: Number(process.env.PG_POOL_MIN || 0),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 10000),
      connectionTimeoutMillis: Number(
        process.env.PG_CONNECTION_TIMEOUT_MS || 5000,
      ),
      allowExitOnIdle: false,
    });

    pool.on("connect", () => {
      if (process.env.NODE_ENV === "development") {
        console.log("[PG POOL] client connected");
      }
    });

    pool.on("acquire", () => {
      if (process.env.NODE_ENV === "development") {
        console.log("[PG POOL] client acquired");
      }
    });

    pool.on("remove", () => {
      if (process.env.NODE_ENV === "development") {
        console.log("[PG POOL] client removed");
      }
    });

    pool.on("error", (err) => {
      console.error("[PG POOL ERROR]", err);
    });

    const adapter = new PrismaPg(pool);

    super({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["error", "warn"]
          : ["error"],
    });

    this.pool = pool;
  }

  async onModuleInit() {
    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      console.log("[Prisma] connected");
    } catch (error) {
      console.error("[Prisma] failed to connect on module init", error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    try {
      await this.$disconnect();
    } catch (error) {
      console.error("[Prisma] disconnect error", error);
    }

    try {
      await this.pool.end();
    } catch (error) {
      console.error("[PG POOL] end error", error);
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

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  }
}