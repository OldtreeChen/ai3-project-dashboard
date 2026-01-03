import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __tcProjectOwnerCol?: string | null;
};

export async function getProjectOwnerColumn(): Promise<string | null> {
  if (typeof globalCache.__tcProjectOwnerCol === 'string' && globalCache.__tcProjectOwnerCol) return globalCache.__tcProjectOwnerCol;
  const m = await getEcpMapping();

  // columns of project table
  const colsInfo = await getEcpColumns();
  const cols = (colsInfo.columns as any)?.[m.tables.project] as Array<{ column_name: string }> | undefined;
  const all = (cols || []).map((c) => c.column_name);
  const set = new Set(all);

  const candidates = [
    // 1) mapping（可能被 config 覆蓋成錯的，需驗證存在）
    m.project.ownerUserId,
    // 2) common ECP names
    // TcProject 常見：FUserId 直接就是 PM/Owner
    'FUserId',
    'FProjectOwnerId',
    'FOwnerUserId',
    'FPMUserId',
    'FProjectManagerId',
    // 3) generic names
    'ProjectOwnerId',
    'OwnerUserId',
    'ownerUserId',
    'owner_id',
    'pm_user_id'
  ].filter(Boolean) as string[];

  const existing = candidates.filter((c) => set.has(c));
  // Add common "user" columns that often store the PM/owner in TcProject
  for (const extra of ['FAssigneeId', 'FCreateUserId', 'FUpdateUserId']) {
    if (set.has(extra) && !existing.includes(extra)) existing.push(extra);
  }

  // If multiple candidates exist, pick the one with the most distinct non-empty values.
  if (existing.length) {
    const P = sqlId(m.tables.project);
    let best: { col: string; score: number } | null = null;
    for (const c of existing) {
      let colId: string;
      try {
        colId = sqlId(c);
      } catch {
        continue;
      }
      const sql = `
        SELECT COUNT(DISTINCT p.${colId}) AS c
        FROM ${P} p
        WHERE p.${colId} IS NOT NULL AND p.${colId} <> ''
          AND p.${sqlId(m.project.name)} NOT LIKE '%新人%'
      `;
      try {
        const r = (await prisma.$queryRawUnsafe<Array<{ c: number }>>(sql))?.[0]?.c ?? 0;
        const score = Number(r || 0);
        if (!best || score > best.score) best = { col: c, score };
      } catch {
        // ignore and keep trying other candidates
      }
    }

    if (best && best.score > 0) {
      globalCache.__tcProjectOwnerCol = best.col;
      return best.col;
    }
    // fallback to the first existing candidate if all scores are 0
    globalCache.__tcProjectOwnerCol = existing[0];
    return existing[0];
  }

  // heuristic fallback: look for something like owner/pm/manager + id
  const heuristic =
    all.find((c) => /owner.*id/i.test(c)) ||
    all.find((c) => /pm.*id/i.test(c)) ||
    all.find((c) => /manager.*id/i.test(c)) ||
    null;

  globalCache.__tcProjectOwnerCol = heuristic;
  return heuristic;
}


