import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

/**
 * Create PostgreSQL connection pool
 */
export const pool = new Pool({
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

let closePromise: Promise<void> | null = null;

export function closeDatabase(): Promise<void> {
  closePromise ??= (async () => {
    await prisma.$disconnect();
    await pool.end();
  })();
  return closePromise;
}

/**
 * Gracefully close Prisma connection on process termination
 */
process.once('beforeExit', async () => {
  await closeDatabase();
});
