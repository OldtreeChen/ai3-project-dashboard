import { prisma } from '@/lib/prisma';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

function tryLoadConfig(): any {
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  try {
    const cfg = tryLoadConfig();
    const table = cfg?.ecp?.tables?.checkIn || 'TcCheckIn';

    const url = new URL(req.url);
    const month = url.searchParams.get('month') || '2026-03';

    // 1. FCheckinType distribution for this month
    const typeStats = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ci.FCheckinType, ci.FExType, ci.FStatus, COUNT(*) AS cnt
       FROM \`${table}\` ci
       WHERE ci.FRegTime >= ? AND ci.FRegTime < ?
       GROUP BY ci.FCheckinType, ci.FExType, ci.FStatus
       ORDER BY cnt DESC`,
      `${month}-01`,
      month === '2026-03' ? '2026-04-01' : `${month}-01`
    );

    // 2. Sample of each FCheckinType
    const types = [...new Set(typeStats.map((r: any) => String(r.FCheckinType)))];
    const samples: Record<string, any[]> = {};
    for (const t of types.slice(0, 6)) {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ci.FId, ci.FName, ci.FUserId, ci.FLoginName, ci.FCheckinType, ci.FExType,
                ci.FRegTime, ci.FPreOrReCheckInDate, ci.FStatus, ci.FLateMinutes, ci.FLeaveEarlyMinutes
         FROM \`${table}\` ci
         WHERE ci.FRegTime >= ? AND ci.FRegTime < ?
           AND ci.FCheckinType = ?
         ORDER BY ci.FRegTime DESC
         LIMIT 3`,
        `${month}-01`,
        month === '2026-03' ? '2026-04-01' : `${month}-01`,
        t
      );
      samples[t] = rows.map((row: any) => {
        const obj: any = {};
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'bigint') obj[k] = String(v);
          else if (v instanceof Date) obj[k] = v.toISOString();
          else obj[k] = v;
        }
        return obj;
      });
    }

    // 3. Total records this month
    const totalRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS total FROM \`${table}\` ci
       WHERE ci.FRegTime >= ? AND ci.FRegTime < ?`,
      `${month}-01`,
      month === '2026-03' ? '2026-04-01' : `${month}-01`
    );

    return Response.json({
      ok: true,
      month,
      table,
      total_records: Number(totalRows[0]?.total || 0),
      type_distribution: typeStats.map((r: any) => ({
        FCheckinType: r.FCheckinType,
        FExType: r.FExType,
        FStatus: r.FStatus,
        count: Number(r.cnt)
      })),
      samples
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message ? String(err.message) : 'unknown' }, { status: 500 });
  }
}
