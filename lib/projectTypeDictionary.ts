import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getDictionaryTextsByValues } from '@/lib/dictionary';

const globalCache = globalThis as unknown as {
  __projectTypeDictId?: string | null;
  __projectTypeDictTable?: string | null;
  __projectTypeTextByValue?: Map<string, string>;
};

function normKey(v: unknown) {
  return String(v ?? '').trim();
}

// 依照使用者提供的畫面中出現的「專案類型」文字（用來定位正確的 dictionaryId）
const PROJECT_TYPE_TEXT_HINTS = [
  '建置類專案',
  '維護類',
  '雲端租賃（一般）',
  '雲端租賃(一般)',
  '後勤專案管理',
  '開發類專案',
  '人時案',
  '智能客服租賃案',
  '系統租賃專案'
];

const FALLBACK_PROJECT_TYPE_ZH: Record<string, string> = {
  Implementation: '建置類專案',
  Build: '建置類專案',
  Maintenance: '維護類',
  ManHour: '人時案',
  Manhour: '人時案',
  MainPower: '人時案'
};

function normalizeTextForCompare(s: string) {
  // 去除空白（含全形空白），並把全形括號轉半形，便於比對
  return s
    .replace(/[ \t\r\n\u3000]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim();
}

async function getProjectTypeDictionaryId(): Promise<string | null> {
  const m = await getEcpMapping();
  const dictTable = m.tables.dictionaryItem || null;
  // If dictionary table changes (e.g. QsDictionaryItem -> TsDictionaryItem), reset cache
  if (globalCache.__projectTypeDictTable !== dictTable) {
    globalCache.__projectTypeDictTable = dictTable;
    globalCache.__projectTypeDictId = undefined;
    globalCache.__projectTypeTextByValue = undefined;
  }
  if (globalCache.__projectTypeDictId !== undefined) return globalCache.__projectTypeDictId;

  if (!m.tables.dictionaryItem || !m.dictionaryItem?.dictionaryId || !m.dictionaryItem?.text) {
    globalCache.__projectTypeDictId = null;
    return null;
  }

  const DI = sqlId(m.tables.dictionaryItem);
  const diDictId = sqlId(m.dictionaryItem.dictionaryId);
  const diText = sqlId(m.dictionaryItem.text);

  const normalizedHints = PROJECT_TYPE_TEXT_HINTS.map(normalizeTextForCompare);
  const placeholders = normalizedHints.map(() => '?').join(',');

  // 注意：用 SQL 端做 text normalization，避免資料庫內有全形括號/空白造成比對失敗
  const sql = `
    SELECT d.${diDictId} AS dictionary_id, COUNT(1) AS cnt
    FROM ${DI} d
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(d.${diText}, '　', ''), ' ', ''), '（', '('), '）', ')') IN (${placeholders})
    GROUP BY d.${diDictId}
    ORDER BY cnt DESC
    LIMIT 1
  `;

  try {
    const row = (await prisma.$queryRawUnsafe<any[]>(sql, ...normalizedHints))?.[0];
    globalCache.__projectTypeDictId = row?.dictionary_id ? String(row.dictionary_id) : null;
    return globalCache.__projectTypeDictId;
  } catch {
    globalCache.__projectTypeDictId = null;
    return null;
  }
}

/**
 * 依照「專案類型」的正確 dictionaryId 查中文（避免不同 dictionary 中 value 重複導致對應錯）
 */
export async function getProjectTypeTextsByValues(values: unknown[]): Promise<Map<string, string>> {
  if (!globalCache.__projectTypeTextByValue) globalCache.__projectTypeTextByValue = new Map();
  const cache = globalCache.__projectTypeTextByValue;

  const keys = Array.from(new Set(values.map(normKey).filter(Boolean)));
  const missing = keys.filter((k) => !cache.has(k));
  if (!missing.length) return cache;

  const m = await getEcpMapping();
  const dictId = await getProjectTypeDictionaryId();

  // 若找不到正確 dictId，退回原本的 best-effort（可能不準，但至少不會 500）
  if (!dictId || !m.tables.dictionaryItem || !m.dictionaryItem?.dictionaryId || !m.dictionaryItem?.value || !m.dictionaryItem?.text) {
    const fallback = await getDictionaryTextsByValues(missing);
    for (const k of missing) {
      const t = fallback.get(k);
      if (t) cache.set(k, t);
    }
    return cache;
  }

  const DI = sqlId(m.tables.dictionaryItem);
  const diDictId = sqlId(m.dictionaryItem.dictionaryId);
  const diValue = sqlId(m.dictionaryItem.value);
  const diText = sqlId(m.dictionaryItem.text);

  const placeholders = missing.map(() => '?').join(',');
  const sql = `
    SELECT d.${diValue} AS value, d.${diText} AS text
    FROM ${DI} d
    WHERE d.${diDictId} = ?
      AND d.${diValue} IN (${placeholders})
  `;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string; text: string }>>(sql, dictId, ...missing);
    for (const r of rows) {
      const k = normKey(r.value);
      const t = normKey(r.text);
      if (k && t) cache.set(k, t);
    }
  } catch {
    // ignore
  }

  // fallback mapping for known codes (when dictionary does not contain them)
  for (const k of missing) {
    if (cache.has(k)) continue;
    const t = FALLBACK_PROJECT_TYPE_ZH[k];
    if (t) cache.set(k, t);
  }

  return cache;
}


