import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function tryLoadConfig() {
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveDatabaseUrl() {
  // 1) 環境變數（建議正式環境用這個）
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 2) config.json（避免此環境無法寫 .env）
  const cfg = tryLoadConfig();
  const v = (cfg.databaseUrl || cfg.dbUrl) as string | undefined;
  if (typeof v === 'string' && v.trim()) return v.trim();

  // 3) fallback：開發示範用（避免直接壞掉）
  // 如果你是 MariaDB，請務必提供 DATABASE_URL 或 config.json
  return 'mysql://root:password@localhost:3306/hours_dashboard';
}

const url = resolveDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: { url }
    }
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;


