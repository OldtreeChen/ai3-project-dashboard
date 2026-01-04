import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __taskPlannedHoursCol?: string | null;
};

type ColInfo = { column_name: string; data_type?: string };

function isNumericType(t?: string) {
  const s = String(t || '').toLowerCase();
  return (
    s.includes('int') ||
    s.includes('double') ||
    s.includes('float') ||
    s.includes('decimal') ||
    s.includes('numeric')
  );
}

async function countNonZero(table: string, col: string) {
  const T = sqlId(table);
  const C = sqlId(col);
  const sql = `
    SELECT COUNT(1) AS cnt
    FROM ${T}
    WHERE ${C} IS NOT NULL
      AND ${C} <> 0
  `;
  const row = (await prisma.$queryRawUnsafe<any[]>(sql))?.[0];
  return Number(row?.cnt ?? 0);
}

/**
 * 偵測「任務預估時數」欄位（對應 ECP 畫面「預估時數」）
 * - 很多環境不是 FPlanHours，而是 FPredictHour
 * - 以「非 0 且非空」筆數最多者為準
 */
export async function getTaskPlannedHoursColumn(): Promise<string | null> {
  if (globalCache.__taskPlannedHoursCol !== undefined) return globalCache.__taskPlannedHoursCol;

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const cols = ((colsInfo.columns as any)?.[m.tables.task] as ColInfo[]) || [];
  const byName = new Map(cols.map((c) => [c.column_name, c]));
  const exists = (c?: string) => (c && byName.has(c) ? c : null);

  const candidates = [
    exists(m.task.plannedHours),
    exists('FPredictHour'),
    exists('FPlanHours'),
    exists('FPlannedHours'),
    exists('FPredictCompletedTime') // just in case someone misused this as hours; filtered out by type usually
  ].filter(Boolean) as string[];

  const numericCandidates = Array.from(new Set(candidates)).filter((c) => isNumericType(byName.get(c)?.data_type));
  if (!numericCandidates.length) {
    globalCache.__taskPlannedHoursCol = null;
    return null;
  }

  let best: { col: string; cnt: number } | null = null;
  for (const c of numericCandidates) {
    const cnt = await countNonZero(m.tables.task, c);
    if (!best || cnt > best.cnt) best = { col: c, cnt };
  }

  globalCache.__taskPlannedHoursCol = best?.col || numericCandidates[0] || null;
  return globalCache.__taskPlannedHoursCol;
}


