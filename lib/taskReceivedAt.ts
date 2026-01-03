import fs from 'node:fs';
import path from 'node:path';

import { getEcpColumns, getEcpMapping } from '@/lib/ecpSchema';

function tryLoadConfig(): any {
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function norm(s: string) {
  return s.toLowerCase();
}

function pick(cols: Array<{ column_name: string }>, candidates: string[]) {
  const byLower = new Map(cols.map((c) => [norm(c.column_name), c.column_name]));
  for (const cand of candidates) {
    const exact = byLower.get(norm(cand));
    if (exact) return exact;
  }
  const lowers = cols.map((c) => ({ lower: norm(c.column_name), raw: c.column_name }));
  for (const cand of candidates) {
    const cl = norm(cand);
    const hit = lowers.find((c) => c.lower.includes(cl));
    if (hit) return hit.raw;
  }
  return null;
}

const globalCache = globalThis as unknown as {
  __taskReceivedAtCol?: string;
};

export async function getTaskReceivedAtColumn(): Promise<string> {
  if (globalCache.__taskReceivedAtCol) return globalCache.__taskReceivedAtCol;

  const cfg = tryLoadConfig();
  const override = cfg?.ecp?.columns?.task?.receivedAt as string | undefined;
  if (override && typeof override === 'string' && override.trim()) {
    globalCache.__taskReceivedAtCol = override.trim();
    return globalCache.__taskReceivedAtCol;
  }

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const cols = (colsInfo.columns as any)?.[m.tables.task] as Array<{ column_name: string }> | undefined;
  const list = Array.isArray(cols) ? cols : [];

  const receivedAt =
    pick(list, [
      // ECP 常見欄位（你先前的 SQL: FFirstCommitmentDate/Time）
      'FFirstCommitmentDate',
      'FFirstCommitmentTime',
      // 其他常見命名
      'ReceiveDate',
      'ReceiveTime',
      'ReceivedAt',
      'ReceivedDate',
      'AssignDate',
      'AssignTime',
      'AssignedAt',
      'CreateDate',
      'CreateTime',
      'CreatedAt',
      'FCreateDate',
      'FCreateTime',
      'FCreatedAt'
    ]) ||
    // 最後 fallback：任何包含 create/assign/commit 的欄位
    pick(list, ['commit', 'assign', 'create']);

  if (!receivedAt) {
    throw new Error(
      [
        `無法偵測任務「接收日期」欄位（table=${m.tables.task}）。`,
        '請到 /schema 確認 TcTask 的欄位，並在 config.json 補上：',
        '{ "ecp": { "columns": { "task": { "receivedAt": "FFirstCommitmentDate" }}}}'
      ].join('\n')
    );
  }

  globalCache.__taskReceivedAtCol = receivedAt;
  return receivedAt;
}


