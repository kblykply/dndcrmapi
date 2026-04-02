import "dotenv/config";
import * as argon2 from "argon2";

const prismaPkg: any = require("@prisma/client");

const prisma = new prismaPkg.PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

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

  console.log("Seeded:");
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
  });
  