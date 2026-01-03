import { getDictionaryTextsByValues } from '@/lib/dictionary';
import { getEcpColumns, getEcpMapping } from '@/lib/ecpSchema';

// 常見專案類型（若 dictionary table 無法查到，先用這份 fallback）
const FALLBACK_PROJECT_TYPE_ZH: Record<string, string> = {
  Build: '建置類專案',
  Implementation: '建置類專案',
  ManHour: '人時案',
  Manhour: '人時案',
  Hour: '人時案'
};

const globalCache = globalThis as unknown as {
  __tcProjectTypeCol?: string | null;
};

export async function getProjectTypeColumn(): Promise<string | null> {
  if (globalCache.__tcProjectTypeCol !== undefined) return globalCache.__tcProjectTypeCol;

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const cols = (colsInfo.columns as any)?.[m.tables.project] as Array<{ column_name: string }> | undefined;
  const all = (cols || []).map((c) => c.column_name);
  const set = new Set(all);

  const candidates = [
    m.project.projectType,
    'FProjectType',
    'FType',
    'projectType',
    'project_type',
    'type'
  ].filter(Boolean) as string[];

  const picked = candidates.find((c) => set.has(c)) || all.find((c) => /type/i.test(c)) || null;
  globalCache.__tcProjectTypeCol = picked;
  return picked;
}

export async function toZhProjectType(raw: unknown) {
  const v = String(raw ?? '').trim();
  if (!v) return '--';

  // 1) 先用 dictionary table（若有）
  const map = await getDictionaryTextsByValues([v]);
  const t = map.get(v);
  if (t) return t;

  // 2) fallback
  return FALLBACK_PROJECT_TYPE_ZH[v] || v;
}


