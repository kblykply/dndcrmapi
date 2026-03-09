require("dotenv/config");
const argon2 = require("argon2");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");

const prismaPkg = require("@prisma/client");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new prismaPkg.PrismaClient({ adapter });

async function main() {
  const pw = await argon2.hash("Passw0rd!123");

  await prisma.user.upsert({
    where: { email: "callcenter@crm.local" },
    update: {},
    create: { email: "callcenter@crm.local", name: "Call Center", role: "CALLCENTER", passwordHash: pw },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@crm.local" },
    update: {},
    create: { email: "manager@crm.local", name: "Manager", role: "MANAGER", passwordHash: pw },
  });

  await prisma.user.upsert({
    where: { email: "sales@crm.local" },
    update: {},
    create: { email: "sales@crm.local", name: "Sales Rep", role: "SALES", passwordHash: pw, managerId: manager.id },
  });

  console.log("Seeded OK");
  console.log("callcenter@crm.local / Passw0rd!123");
  console.log("manager@crm.local / Passw0rd!123");
  console.log("sales@crm.local / Passw0rd!123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });