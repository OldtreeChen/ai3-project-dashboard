import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getUserActiveFilter } from '@/lib/userActive';
import { buildWhitelistWhere, getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { parseIdParam } from '../../_utils';
import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

function parseMonthParam(v: string | null) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || yyyy < 1900 || yyyy > 2500 || mm < 1 || mm > 12) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const next = new Date(yyyy, mm, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { yyyy, mm, start, end };
}

function getWorkdays(yyyy: number, mm: number): string[] {
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  const result: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(yyyy, mm - 1, d).getDay();
    if (day === 0 || day === 6) continue;
    const dd = String(d).padStart(2, '0');
    const mmStr = String(mm).padStart(2, '0');
    result.push(`${yyyy}-${mmStr}-${dd}`);
  }
  return result;
}

function fmtDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function fmtTime(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const h = String(v.getHours()).padStart(2, '0');
    const m = String(v.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(v);
  // "HH:MM:SS" or "HH:MM"
  const tm = s.match(/(\d{2}:\d{2})/);
  return tm ? tm[1] : null;
}

function tryLoadConfig(): any {
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function getCheckInTable(): Promise<string | null> {
  const cfg = tryLoadConfig();
  const fromCfg = cfg?.ecp?.tables?.checkIn;
  if (fromCfg) return fromCfg;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT t.table_name
       FROM information_schema.tables t
       WHERE t.table_schema = DATABASE()
         AND (t.table_name LIKE '%CheckIn%' OR t.table_name LIKE '%checkin%')
         AND t.table_name NOT LIKE '%_b4_%'
         AND t.table_name NOT LIKE '%Rpt%'
       ORDER BY t.table_rows DESC
       LIMIT 1`
    );
    return rows[0]?.table_name || null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = parseMonthParam(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid month (expected YYYY-MM)' }, { status: 400 });

    const departmentId = parseIdParam(url.searchParams.get('departmentId'));

    const checkInTable = await getCheckInTable();
    if (!checkInTable) {
      return Response.json({ error: 'CheckIn table not found in database' }, { status: 500 });
    }

    const m = await getEcpMapping();
    const U = sqlId(m.tables.user);
    const CI = sqlId(checkInTable);

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

    const active = await getUserActiveFilter(m.tables.user, 'u');
    const { dept1Id, dept2Id } = await getAiDeptIds();
    const wl = buildWhitelistWhere({
      uName: String(uName),
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id
    });

    // Query: get all whitelisted users
    let userSql = `
      SELECT u.${uId} AS person_id, u.${uName} AS display_name,
        ${uDeptId ? `u.${uDeptId} AS department_id` : 'NULL AS department_id'}
      FROM ${U} u
      WHERE 1=1
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;
    const userArgs: any[] = ['%MidECP-User%', '%service_user%'];
    userSql += active.where;
    userSql += wl.where;
    userArgs.push(...wl.args);
    userSql += ` ORDER BY u.${uName} ASC`;

    const users = await prisma.$queryRawUnsafe<any[]>(userSql, ...userArgs);

    // Query: check-in records for the month
    // Use range query on FRegTime for better performance (indexed), then also check FPreOrReCheckInDate
    const ciSql = `
      SELECT
        ci.\`FUserId\` AS user_id,
        DATE(COALESCE(ci.\`FPreOrReCheckInDate\`, ci.\`FRegTime\`)) AS checkin_date,
        MIN(CASE WHEN ci.\`FExType\` = '1' OR (ci.\`FExType\` IS NULL AND ci.\`FCheckinType\` IN ('1','3'))
            THEN COALESCE(ci.\`FPreOrReCheckInDate\`, ci.\`FRegTime\`) END) AS first_clock_in,
        MAX(CASE WHEN ci.\`FExType\` = '2' OR (ci.\`FExType\` IS NULL AND ci.\`FCheckinType\` IN ('2','4'))
            THEN COALESCE(ci.\`FPreOrReCheckInDate\`, ci.\`FRegTime\`) END) AS last_clock_out,
        MAX(ci.\`FLateMinutes\`) AS late_minutes,
        MAX(ci.\`FLeaveEarlyMinutes\`) AS leave_early_minutes,
        COUNT(*) AS punch_count
      FROM ${CI} ci
      WHERE (ci.\`FRegTime\` >= ? AND ci.\`FRegTime\` < ?)
         OR (ci.\`FPreOrReCheckInDate\` >= ? AND ci.\`FPreOrReCheckInDate\` < ?)
      GROUP BY ci.\`FUserId\`, DATE(COALESCE(ci.\`FPreOrReCheckInDate\`, ci.\`FRegTime\`))
    `;
    const ciRows = await prisma.$queryRawUnsafe<any[]>(ciSql, month.start, month.end, month.start, month.end);

    // Build lookup: userId|date -> day info
    type CiDay = {
      clock_in: string | null;
      clock_out: string | null;
      late_minutes: number | null;
      leave_early_minutes: number | null;
      punch_count: number;
    };
    const ciMap = new Map<string, CiDay>();
    for (const row of ciRows) {
      const dateStr = fmtDate(row.checkin_date);
      if (!dateStr) continue;
      const key = `${row.user_id}|${dateStr}`;
      ciMap.set(key, {
        clock_in: fmtTime(row.first_clock_in),
        clock_out: fmtTime(row.last_clock_out),
        late_minutes: row.late_minutes != null ? Number(row.late_minutes) : null,
        leave_early_minutes: row.leave_early_minutes != null ? Number(row.leave_early_minutes) : null,
        punch_count: Number(row.punch_count || 0)
      });
    }

    const workdays = getWorkdays(month.yyyy, month.mm);

    type PersonRecord = {
      person_id: string;
      display_name: string;
      department_id: string | null;
      days: Record<string, CiDay>;
      total_checkin_days: number;
      total_late_count: number;
    };

    // Build per-person structure from users + checkin data
    const seen = new Set<string>();
    const people: PersonRecord[] = [];

    for (const u of users) {
      const pid = String(u.person_id || '');
      const name = String(u.display_name ?? '').trim();
      if (!pid || !name) continue;

      const nameKey = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (seen.has(nameKey)) continue;
      seen.add(nameKey);

      const days: Record<string, CiDay> = {};
      let checkinDays = 0;
      let lateCount = 0;

      for (const date of workdays) {
        const ci = ciMap.get(`${pid}|${date}`);
        if (ci) {
          days[date] = ci;
          checkinDays++;
          if (ci.late_minutes && ci.late_minutes > 0) lateCount++;
        }
      }

      people.push({
        person_id: pid,
        display_name: name,
        department_id: u.department_id ? String(u.department_id) : null,
        days,
        total_checkin_days: checkinDays,
        total_late_count: lateCount
      });
    }

    // Sort: least checkin days first
    people.sort((a, b) => a.total_checkin_days - b.total_checkin_days || a.display_name.localeCompare(b.display_name, 'zh-Hant'));

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      workdays,
      filters: { departmentId: departmentId || null },
      people
    });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ? String(err.message) : 'unknown error' },
      { status: 500 }
    );
  }
}
