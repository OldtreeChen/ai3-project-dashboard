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

/** Return all workdays (Mon–Fri) in the given month as YYYY-MM-DD strings. */
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

function tryLoadConfig(): any {
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Detect checkIn table name from config or auto-discover */
async function getCheckInTable(): Promise<string | null> {
  const cfg = tryLoadConfig();
  const fromCfg = cfg?.ecp?.tables?.checkIn;
  if (fromCfg) return fromCfg;

  // Auto-discover
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

    const m = await getEcpMapping();

    const U = sqlId(m.tables.user);
    const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;
    const TR = sqlId(m.tables.time);

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

    const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
    const thWorkDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;
    const thUserId = m.timeReport?.userId ? sqlId(m.timeReport.userId) : null;

    const trTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;
    const trHours = sqlId(m.time.hours);

    if (!(TH && thId && thWorkDate && thUserId && trTimeReportId)) {
      return Response.json(
        { error: 'timeReport mapping incomplete (need timeReport.id, workDate, userId and timeDetail.timeReportId)' },
        { status: 500 }
      );
    }

    // Build common WHERE filters
    const active = await getUserActiveFilter(m.tables.user, 'u');
    const { dept1Id, dept2Id } = await getAiDeptIds();
    const wl = buildWhitelistWhere({
      uName: String(uName),
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id
    });

    // ---- Query 1: Time report hours per person per day ----
    let sql = `
      SELECT
        u.${uId} AS person_id,
        u.${uName} AS display_name,
        ${uDeptId ? `u.${uDeptId} AS department_id,` : 'NULL AS department_id,'}
        DATE(th.${thWorkDate}) AS work_date,
        COALESCE(SUM(tr.${trHours}), 0) AS hours
      FROM ${U} u
      LEFT JOIN ${TH} th
        ON th.${thUserId} = u.${uId}
        AND th.${thWorkDate} >= ? AND th.${thWorkDate} < ?
      LEFT JOIN ${TR} tr
        ON tr.${trTimeReportId} = th.${thId}
      WHERE 1=1
    `;

    const args: any[] = [month.start, month.end];

    sql += ` AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?`;
    args.push('%MidECP-User%', '%service_user%');
    sql += active.where;
    sql += wl.where;
    args.push(...wl.args);

    sql += ` GROUP BY u.${uId}, DATE(th.${thWorkDate})`;
    sql += ` ORDER BY u.${uName} ASC, work_date ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // ---- Query 2: CheckIn data per person per day ----
    const checkInTable = await getCheckInTable();
    type CheckInRow = { user_id: string; checkin_date: string; clock_in: string | null; clock_out: string | null; late_minutes: number | null };
    let checkInRows: CheckInRow[] = [];

    if (checkInTable) {
      const CI = sqlId(checkInTable);
      // FExType: 1=上班(clock in), 2=下班(clock out)
      // Use FPreOrReCheckInDate as the work date (handles both normal and supplementary check-ins)
      // FRegTime is fallback for older records
      const ciSql = `
        SELECT
          ci.FUserId AS user_id,
          DATE(COALESCE(ci.FPreOrReCheckInDate, ci.FRegTime)) AS checkin_date,
          MIN(CASE WHEN ci.FExType = '1' THEN TIME(COALESCE(ci.FPreOrReCheckInDate, ci.FRegTime)) END) AS clock_in,
          MAX(CASE WHEN ci.FExType = '2' THEN TIME(COALESCE(ci.FPreOrReCheckInDate, ci.FRegTime)) END) AS clock_out,
          MAX(ci.FLateMinutes) AS late_minutes
        FROM ${CI} ci
        WHERE DATE(COALESCE(ci.FPreOrReCheckInDate, ci.FRegTime)) >= ?
          AND DATE(COALESCE(ci.FPreOrReCheckInDate, ci.FRegTime)) < ?
        GROUP BY ci.FUserId, DATE(COALESCE(ci.FPreOrReCheckInDate, ci.FRegTime))
      `;
      try {
        checkInRows = await prisma.$queryRawUnsafe<CheckInRow[]>(ciSql, month.start, month.end);
      } catch (e) {
        console.error('CheckIn query failed:', e);
      }
    }

    // Build checkIn lookup: userId+date -> { clock_in, clock_out, late_minutes }
    const checkInMap = new Map<string, { clock_in: string | null; clock_out: string | null; late_minutes: number | null }>();
    for (const row of checkInRows) {
      const key = `${row.user_id}|${String(row.checkin_date).slice(0, 10)}`;
      checkInMap.set(key, {
        clock_in: row.clock_in ? String(row.clock_in) : null,
        clock_out: row.clock_out ? String(row.clock_out) : null,
        late_minutes: row.late_minutes != null ? Number(row.late_minutes) : null
      });
    }

    // Build per-person structure
    const workdays = getWorkdays(month.yyyy, month.mm);

    type DayInfo = {
      hours: number;
      checked_in: boolean;
      clock_in: string | null;
      clock_out: string | null;
      late_minutes: number | null;
    };
    type PersonRecord = {
      person_id: string;
      display_name: string;
      department_id: string | null;
      days: Record<string, DayInfo>;
      total_reported_days: number;
      total_hours: number;
      total_checkin_days: number;
    };

    const personMap = new Map<string, PersonRecord>();

    for (const row of rows) {
      const pid = String(row.person_id || '');
      if (!pid) continue;
      const name = String(row.display_name ?? '').trim();
      if (!name) continue;

      if (!personMap.has(pid)) {
        personMap.set(pid, {
          person_id: pid,
          display_name: name,
          department_id: row.department_id ? String(row.department_id) : null,
          days: {},
          total_reported_days: 0,
          total_hours: 0,
          total_checkin_days: 0
        });
      }
      const p = personMap.get(pid)!;

      const dateStr = row.work_date ? String(row.work_date).slice(0, 10) : null;
      const hours = Number(row.hours || 0);
      if (dateStr) {
        if (!p.days[dateStr]) {
          p.days[dateStr] = { hours: 0, checked_in: false, clock_in: null, clock_out: null, late_minutes: null };
        }
        p.days[dateStr].hours += hours;
      }
    }

    // Merge checkIn data into person records
    for (const p of personMap.values()) {
      for (const date of workdays) {
        const ciKey = `${p.person_id}|${date}`;
        const ci = checkInMap.get(ciKey);
        if (!p.days[date]) {
          p.days[date] = { hours: 0, checked_in: false, clock_in: null, clock_out: null, late_minutes: null };
        }
        if (ci) {
          p.days[date].checked_in = true;
          p.days[date].clock_in = ci.clock_in;
          p.days[date].clock_out = ci.clock_out;
          p.days[date].late_minutes = ci.late_minutes;
        }
      }
    }

    // De-dupe by normalized display name
    const seen = new Set<string>();
    const people: PersonRecord[] = [];
    for (const p of personMap.values()) {
      const key = p.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (seen.has(key)) {
        const idx = people.findIndex(
          (x) => x.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase() === key
        );
        if (idx >= 0) {
          const existing = people[idx];
          const existingScore = existing.total_hours + Object.keys(existing.days).length;
          const newScore = Object.values(p.days).reduce((a, b) => a + b.hours, 0) + Object.keys(p.days).length;
          if (newScore > existingScore) people[idx] = p;
        }
        continue;
      }
      seen.add(key);
      people.push(p);
    }

    // Compute totals
    for (const p of people) {
      let reportedDays = 0;
      let totalHours = 0;
      let checkinDays = 0;
      for (const date of workdays) {
        const d = p.days[date];
        if (!d) continue;
        if (d.hours > 0) reportedDays++;
        totalHours += d.hours;
        if (d.checked_in) checkinDays++;
      }
      p.total_reported_days = reportedDays;
      p.total_hours = totalHours;
      p.total_checkin_days = checkinDays;
    }

    // Sort: by total_reported_days ASC (least compliant first), then by name
    people.sort((a, b) => a.total_reported_days - b.total_reported_days || a.display_name.localeCompare(b.display_name, 'zh-Hant'));

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      workdays,
      has_checkin: !!checkInTable,
      filters: { departmentId: departmentId || null },
      people: people.map((p) => ({
        person_id: p.person_id,
        display_name: p.display_name,
        department_id: p.department_id,
        days: p.days,
        total_reported_days: p.total_reported_days,
        total_hours: Number(p.total_hours.toFixed(1)),
        total_checkin_days: p.total_checkin_days
      }))
    });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ? String(err.message) : 'unknown error' },
      { status: 500 }
    );
  }
}
