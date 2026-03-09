require("dotenv").config();

const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing");
  }

  // Force TLS without verification (dev)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  await prisma.$executeRawUnsafe("SELECT 1");
  console.log("DB OK");

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("DB ERROR:", err.message);
});