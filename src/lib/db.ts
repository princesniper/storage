import { PrismaClient } from '@prisma/client'
import { assertSafeDatabaseTarget } from './database-safety'

// Fail closed before constructing Prisma. Local development must never
// connect to Railway/production, because channel/file/folder mutations would
// otherwise be visible to the deployed app as well.
assertSafeDatabaseTarget(process.env.DATABASE_URL)

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Production: never log SQL queries (noise + potential data leakage into
// log retention). Set LOG_SQL=1 explicitly for a debugging session only.
const enableQueryLog =
  process.env.LOG_SQL === '1' ||
  (process.env.NODE_ENV !== 'production' && process.env.LOG_SQL !== '0')

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: enableQueryLog ? ['query'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
