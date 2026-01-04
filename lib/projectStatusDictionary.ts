import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __projectStatusDictId?: string | null;
  __projectStatusDictTable?: string | null;
  __projectStatusHintsKey?: string | null;
  __projectStatusTextByValue?: Map<string, string>;
};

function normKey(v: unknown) {
  return String(v ?? '').trim();
}

const STATUS_TEXT_HINTS = [
  // 依 ECP 畫面實際常見顯示文字（用來定位正確的 dictionaryId）
  '已分配',
  '執行中',
  '審核中(執行)',
  '審核中(關閉)',
  '返回修改(執行)',
  '返回修改(關閉)',
  '逾時執行中',
  '逾時自動升級中',
  '新增',
  '已關閉',
  '已作廢',
  '取消'
];

function normalizeTextForCompare(s: string) {
  return s
    .replace(/[ \t\r\n\u3000]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim();
}

async function getProjectStatusDictionaryId(): Promise<string | null> {
  const m = await getEcpMapping();
  const dictTable = m.tables.dictionaryItem || null;
  const hintsKey = STATUS_TEXT_HINTS.join('|');
  if (globalCache.__projectStatusDictTable !== dictTable) {
    globalCache.__projectStatusDictTable = dictTable;
    globalCache.__projectStatusDictId = undefined;
    globalCache.__projectStatusTextByValue = undefined;
  }
  if (globalCache.__projectStatusHintsKey !== hintsKey) {
    globalCache.__projectStatusHintsKey = hintsKey;
    globalCache.__projectStatusDictId = undefined;
    globalCache.__projectStatusTextByValue = undefined;
  }
  if (globalCache.__projectStatusDictId !== undefined) return globalCache.__projectStatusDictId;

  if (!m.tables.dictionaryItem || !m.dictionaryItem?.dictionaryId || !m.dictionaryItem?.text) {
    globalCache.__projectStatusDictId = null;
    return null;
  }

  const DI = sqlId(m.tables.dictionaryItem);
  const diDictId = sqlId(m.dictionaryItem.dictionaryId);
  const diText = sqlId(m.dictionaryItem.text);

  const normalizedHints = STATUS_TEXT_HINTS.map(normalizeTextForCompare);
  const placeholders = normalizedHints.map(() => '?').join(',');

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
    globalCache.__projectStatusDictId = row?.dictionary_id ? String(row.dictionary_id) : null;
    return globalCache.__projectStatusDictId;
  } catch {
    globalCache.__projectStatusDictId = null;
    return null;
  }
}

export async function getProjectStatusTextsByValues(values: unknown[]): Promise<Map<string, string>> {
  if (!globalCache.__projectStatusTextByValue) globalCache.__projectStatusTextByValue = new Map();
  const cache = globalCache.__projectStatusTextByValue;

  const keys = Array.from(new Set(values.map(normKey).filter(Boolean)));
  const missing = keys.filter((k) => !cache.has(k));
  if (!missing.length) return cache;

  const m = await getEcpMapping();
  const dictId = await getProjectStatusDictionaryId();

  if (!dictId || !m.tables.dictionaryItem || !m.dictionaryItem?.dictionaryId || !m.dictionaryItem?.value || !m.dictionaryItem?.text) {
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

  return cache;
}


