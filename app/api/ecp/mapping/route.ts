import { getEcpColumns, getEcpMapping } from '@/lib/ecpSchema';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 避免 Promise.all 導致同時觸發兩次 mapping/columns 載入
    const mapping = await getEcpMapping();
    const cols = await getEcpColumns();
    return Response.json({
      ok: true,
      mapping,
      columns: cols.columns
    });
  } catch (err: any) {
    // 不要把 DATABASE_URL 等敏感資訊吐回去
    const message = err?.message ? String(err.message) : 'unknown error';
    return Response.json(
      {
        ok: false,
        error: message,
        hint: [
          '請確認已設定 DATABASE_URL 並可連上 MariaDB。',
          '若出現權限問題（information_schema），我已加 fallback（SHOW FULL COLUMNS），仍失敗就需要 DB 端給予最低讀表權限。',
          '你可以把這個 JSON 的 error 貼回來（不要貼密碼）。'
        ]
      },
      { status: 500 }
    );
  }
}


