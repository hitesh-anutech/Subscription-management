/**
 * Shared Prisma client for all apps.
 *
 * Usage:
 *   import { prisma } from '@subs/db';
 *
 * Re-exports all types from @prisma/client for convenience.
 */
import { PrismaClient } from '@prisma/client';

// globalThis cast — avoids TypeScript-specific `declare global` syntax
// so ts-node workspace interop works correctly with Node 22.
const globalForPrisma = globalThis as unknown as { __subsPrisma: PrismaClient };

export const prisma =
  globalForPrisma.__subsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__subsPrisma = prisma;
}

export * from '@prisma/client';
