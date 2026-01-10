// lib/db.ts
// Prisma Client singleton for Next.js
// Prevents multiple instances in development (hot reload)

import { PrismaClient } from '@prisma/client';

/**
 * Why we need this singleton pattern:
 *
 * In development, Next.js hot-reloads files on every change.
 * Without this pattern, each reload creates a new PrismaClient instance.
 * Result: "Too many database connections" error.
 *
 * Solution: Store PrismaClient on global object (persists across reloads)
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

// In development, attach to global to prevent multiple instances
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Usage in API routes:
 *
 * import { prisma } from '@/lib/db';
 *
 * const users = await prisma.user.findMany();
 * const entry = await prisma.entry.create({ data: {...} });
 */
