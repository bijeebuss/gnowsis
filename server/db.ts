import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

/**
 * Create PostgreSQL connection pool
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Create Prisma adapter for PostgreSQL
 */
const adapter = new PrismaPg(pool);

/**
 * Shared Prisma Client instance
 * Configured for Prisma 7 with PostgreSQL adapter
 */
export const prisma = new PrismaClient({ adapter });

/**
 * Gracefully close Prisma connection on process termination
 */
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await pool.end();
});
