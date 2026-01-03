import { getDictionaryTextsByValues } from '@/lib/dictionary';

// 常見專案類型（若 dictionary table 無法查到，先用這份 fallback）
const FALLBACK_PROJECT_TYPE_ZH: Record<string, string> = {
  Build: '建置類專案',
  Implementation: '建置類專案',
  ManHour: '人時案',
  Manhour: '人時案',
  Hour: '人時案'
};

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


