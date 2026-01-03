import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

const globalCache = globalThis as unknown as {
  __dictTextByValue?: Map<string, string>;
};

function normKey(v: unknown) {
  return String(v ?? '').trim();
}

/**
 * 依據 value（英文代碼）回查 dictionary item 的中文 text。
 * - 不強制使用 dictionaryId（因不同環境 dictionaryId 可能不同）
 * - 會快取在 memory
 */
export async function getDictionaryTextsByValues(values: unknown[]): Promise<Map<string, string>> {
  if (!globalCache.__dictTextByValue) globalCache.__dictTextByValue = new Map();
  const cache = globalCache.__dictTextByValue;

  const keys = Array.from(new Set(values.map(normKey).filter(Boolean)));
  const missing = keys.filter((k) => !cache.has(k));
  if (!missing.length) return cache;

  const m = await getEcpMapping();
  if (!m.tables.dictionaryItem || !m.dictionaryItem?.value || !m.dictionaryItem?.text) return cache;

  const DI = sqlId(m.tables.dictionaryItem);
  const diValue = sqlId(m.dictionaryItem.value);
  const diText = sqlId(m.dictionaryItem.text);

  // MySQL IN 參數要展開
  const placeholders = missing.map(() => '?').join(',');
  const sql = `
    SELECT d.${diValue} AS value, d.${diText} AS text
    FROM ${DI} d
    WHERE d.${diValue} IN (${placeholders})
  `;

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ value: string; text: string }>>(sql, ...missing);
    for (const r of rows) {
      const k = normKey(r.value);
      const t = normKey(r.text);
      if (k && t) cache.set(k, t);
    }
  } catch {
    // ignore dictionary query failure
  }

  return cache;
}


