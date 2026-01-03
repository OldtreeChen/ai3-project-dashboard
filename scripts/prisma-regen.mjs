import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function readConfigDbUrl() {
  const cfgPath = path.resolve(process.cwd(), 'config.json');
  if (!fs.existsSync(cfgPath)) {
    throw new Error('找不到 config.json（請在專案根目錄建立，並設定 databaseUrl / dbUrl）');
  }
  const raw = fs.readFileSync(cfgPath, 'utf-8');
  const cfg = JSON.parse(raw);
  const url = cfg.databaseUrl || cfg.dbUrl;
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('config.json 缺少 databaseUrl（或 dbUrl）');
  }
  return url.trim();
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv }
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const databaseUrl = readConfigDbUrl();

// 清掉舊的生成產物（避免還在用 sqlite 版 client）
rmrf(path.resolve(process.cwd(), 'node_modules', '.prisma'));
rmrf(path.resolve(process.cwd(), 'node_modules', '@prisma', 'client'));

console.log('[prisma-regen] using DATABASE_URL from config.json (masked)');

run('npx', ['prisma', 'generate', '--schema', 'prisma/schema.prisma'], {
  DATABASE_URL: databaseUrl
});

console.log('[prisma-regen] done');


