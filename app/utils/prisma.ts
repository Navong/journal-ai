import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
// Learn more: https://pris.ly/d/help/nextjs-best-practices

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7 with Supabase: Use pooled connection string for Prisma Client
// This should use the connection pooling URL (with ?pgbouncer=true)
// For Supabase: use DATABASE_URL with pooling, DIRECT_URL for CLI operations
const connectionString = process.env.DATABASE_URL;

let prismaInstance: PrismaClient | null = null;

if (connectionString) {
  try {
    // Create a connection pool with optimized settings for better performance
    const pool = new Pool({
      connectionString,
      // Optimized Supabase connection pool settings
      max: 20, // Maximum number of clients in the pool
      min: 2, // Minimum number of clients to keep in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
      // Additional optimizations
      statement_timeout: 30000, // 30 second query timeout
      query_timeout: 30000,
    });

    const adapter = new PrismaPg(pool);
    prismaInstance = new PrismaClient({ adapter });
  } catch (error) {
    console.error('Failed to initialize Prisma Client:', error);
    // Continue without Prisma - API routes will handle this gracefully
  }
}

export const prisma = globalForPrisma.prisma ?? prismaInstance;

if (process.env.NODE_ENV !== 'production' && prismaInstance) {
  globalForPrisma.prisma = prismaInstance;
}
