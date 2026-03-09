import { Injectable, OnModuleInit, INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";

const prismaPkg: any = require("@prisma/client");

@Injectable()
export class PrismaService extends prismaPkg.PrismaClient implements OnModuleInit {
  private pool: Pool;

  constructor() {
    // If you downloaded the cert from Supabase SSL Configuration:
    // place it at: crm/api/supabase-ca.crt
    const caPath = path.join(process.cwd(), "supabase-ca.crt");

    const ssl = fs.existsSync(caPath)
      ? { ca: fs.readFileSync(caPath, "utf8") } // ✅ production-safe
      : { rejectUnauthorized: false }; // ✅ dev fallback (if cert not present)

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  enableShutdownHooks(app: INestApplication) {
    this.$on("beforeExit", async () => {
      await this.$disconnect();
      await this.pool.end();
      await app.close();
    });
  }
}