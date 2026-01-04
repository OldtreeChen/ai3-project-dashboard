import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __taskPlannedStartAtCol?: string | null;
  __taskPlannedStartAtColV?: number;
};

type ColInfo = { column_name: string; data_type?: string };

const CACHE_VERSION = 2;

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
 * 偵測「任務預計開始時間」欄位（用於依任務區間均攤到月份）
 * - 優先挑選有最多非空值的候選欄位
 */
export async function getTaskPlannedStartAtColumn(): Promise<string | null> {
  if (globalCache.__taskPlannedStartAtColV === CACHE_VERSION && globalCache.__taskPlannedStartAtCol !== undefined) {
    return globalCache.__taskPlannedStartAtCol;
  }

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const cols = ((colsInfo.columns as any)?.[m.tables.task] as ColInfo[]) || [];
  const byName = new Map(cols.map((c) => [c.column_name, c]));
  const exists = (c?: string) => (c && byName.has(c) ? c : null);

  // 常見候選：PlanStartDate / PredictStartTime / StandardStartTime / StartDate
  const candidates = [
    exists(m.task.plannedStartAt),
    exists('FPredictStartTime'),
    exists('FStandardStartTime'),
    exists('FPredictStartDate'),
    exists('FPlanStartDate'),
    exists('FPlanStartDateTime'),
    exists('FStartDate'),
    exists('FStartTime')
  ].filter(Boolean) as string[];

  let uniq = Array.from(new Set(candidates.filter((c) => isDateLikeType(byName.get(c)?.data_type))));

  // Fallback: pick any date-like column whose name includes "start" / "begin"
  if (!uniq.length) {
    const fallback = cols
      .filter((c) => isDateLikeType(c.data_type))
      .map((c) => c.column_name)
      .filter((n) => {
        const s = String(n).toLowerCase();
        return s.includes('start') || s.includes('begin');
      });
    uniq = Array.from(new Set(fallback));
  }

  if (!uniq.length) {
    globalCache.__taskPlannedStartAtCol = null;
    globalCache.__taskPlannedStartAtColV = CACHE_VERSION;
    return null;
  }

  let best: { col: string; cnt: number } | null = null;
  for (const c of uniq) {
    const cnt = await countNonNull(m.tables.task, c);
    if (!best || cnt > best.cnt) best = { col: c, cnt };
  }

  globalCache.__taskPlannedStartAtCol = best?.col || uniq[0] || null;
  globalCache.__taskPlannedStartAtColV = CACHE_VERSION;
  return globalCache.__taskPlannedStartAtCol;
}


