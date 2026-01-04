import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __projectPlannedEndCol?: string | null;
};

type ColInfo = { column_name: string; data_type?: string };

function isDateLikeType(t?: string) {
  const s = String(t || '').toLowerCase();
  return s.includes('date') || s.includes('time') || s.includes('timestamp');
}

async function countNonNull(table: string, col: string) {
  const T = sqlId(table);
  const C = sqlId(col);
  const sql = `
    SELECT COUNT(1) AS cnt
    FROM ${T}
    WHERE ${C} IS NOT NULL
      AND ${C} <> ''
  `;
  const row = (await prisma.$queryRawUnsafe<any[]>(sql))?.[0];
  return Number(row?.cnt ?? 0);
}

/**
 * 偵測「專案計畫結束日期」欄位（常見：TcProject.FPlanEndDate）
 * - 以非空值最多者為準
 */
export async function getProjectPlannedEndAtColumn(): Promise<string | null> {
  if (globalCache.__projectPlannedEndCol !== undefined) return globalCache.__projectPlannedEndCol;

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const cols = ((colsInfo.columns as any)?.[m.tables.project] as ColInfo[]) || [];
  const byName = new Map(cols.map((c) => [c.column_name, c]));
  const exists = (c?: string) => (c && byName.has(c) ? c : null);

  const candidates = [
    exists('FPlanEndDate'),
    exists('FPlanEndDateTime'),
    exists('FPlanEndTime'),
    exists('FPlanEnd'),
    exists(m.project.endDate), // fallback
    exists('FEndDate')
  ].filter(Boolean) as string[];

  const dateCandidates = Array.from(new Set(candidates)).filter((c) => isDateLikeType(byName.get(c)?.data_type));
  if (!dateCandidates.length) {
    globalCache.__projectPlannedEndCol = null;
    return null;
  }

  let best: { col: string; cnt: number } | null = null;
  for (const c of dateCandidates) {
    const cnt = await countNonNull(m.tables.project, c);
    if (!best || cnt > best.cnt) best = { col: c, cnt };
  }

  globalCache.__projectPlannedEndCol = best?.col || dateCandidates[0] || null;
  return globalCache.__projectPlannedEndCol;
}


