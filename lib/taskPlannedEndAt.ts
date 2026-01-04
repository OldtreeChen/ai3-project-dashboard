import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __taskPlannedEndAtCol?: string | null;
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
 * 偵測「任務預計結束時間」欄位（對應 ECP 畫面「預計結束時間」）
 * - 優先挑選有最多非空值的候選欄位
 */
export async function getTaskPlannedEndAtColumn(): Promise<string | null> {
  if (globalCache.__taskPlannedEndAtCol !== undefined) return globalCache.__taskPlannedEndAtCol;

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const cols = ((colsInfo.columns as any)?.[m.tables.task] as ColInfo[]) || [];
  const byName = new Map(cols.map((c) => [c.column_name, c]));
  const exists = (c?: string) => (c && byName.has(c) ? c : null);

  // 常見候選：PlanEndDate / PredictEndDate / PredictCompletedTime / StandardCompletedTime
  const candidates = [
    exists(m.task.plannedEndAt),
    exists('FPredictCompletedTime'),
    exists('FStandardCompletedTime'),
    exists('FPredictEndDate'),
    exists('FPlanEndDate'),
    exists('FPlanEndDateTime'),
    exists('FEndDate'),
    exists('FPlanEndTime')
  ].filter(Boolean) as string[];

  // 過濾掉非日期欄位
  const dateCandidates = candidates.filter((c) => isDateLikeType(byName.get(c)?.data_type));
  const uniq = Array.from(new Set(dateCandidates));

  if (!uniq.length) {
    globalCache.__taskPlannedEndAtCol = null;
    return null;
  }

  let best: { col: string; cnt: number } | null = null;
  for (const c of uniq) {
    const cnt = await countNonNull(m.tables.task, c);
    if (!best || cnt > best.cnt) best = { col: c, cnt };
  }

  globalCache.__taskPlannedEndAtCol = best?.col || uniq[0] || null;
  return globalCache.__taskPlannedEndAtCol;
}


