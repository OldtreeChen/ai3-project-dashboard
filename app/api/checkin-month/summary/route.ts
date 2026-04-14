import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getUserActiveFilter } from '@/lib/userActive';
import { buildWhitelistWhere, getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { getWorkdays as getTwWorkdays, getHolidayMap } from '@/lib/taiwanHolidays';
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

function getAllDays(yyyy: number, mm: number): string[] {
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  const result: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0');
    const mmStr = String(mm).padStart(2, '0');
    result.push(`${yyyy}-${mmStr}-${dd}`);
  }
  return result;
}

function getWorkdays(yyyy: number, mm: number): string[] {
  return getAllDays(yyyy, mm).filter((ds) => {
    const dow = new Date(ds + 'T00:00:00').getDay();
    return dow !== 0 && dow !== 6;
  });
}

function fmtDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return null;
}

function fmtTime(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  }
  const s = String(v);
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
      uDeptId: uDeptId ? String(uDeptId) : null,
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id,
      scope: 'checkin',
    });

    // Single JOIN query: users LEFT JOIN checkin
    let sql = `
      SELECT
        u.${uId} AS person_id,
        u.${uName} AS display_name,
        ${uDeptId ? `u.${uDeptId} AS department_id,` : 'NULL AS department_id,'}
        DATE(ci.\`FPreOrReCheckInDate\`) AS checkin_date,
        MIN(CASE
          WHEN ci.\`FCheckinType\` = '1'
            OR (ci.\`FCheckinType\` IN ('5','6') AND ci.\`FExType\` = '1')
            OR (ci.\`FCheckinType\` IN ('5','6') AND ci.\`FExType\` IS NULL AND ci.\`FPreOrReCheckInType\` = '1')
          THEN TIME(ci.\`FPreOrReCheckInDate\`)
        END) AS clock_in,
        MAX(CASE
          WHEN ci.\`FCheckinType\` = '2'
            OR (ci.\`FCheckinType\` IN ('5','6') AND ci.\`FExType\` = '2')
            OR (ci.\`FCheckinType\` IN ('5','6') AND ci.\`FExType\` IS NULL AND ci.\`FPreOrReCheckInType\` = '2')
          THEN TIME(ci.\`FPreOrReCheckInDate\`)
        END) AS clock_out,
        MAX(CASE WHEN ci.\`FCheckinType\` = '1' THEN ci.\`FLateMinutes\` END) AS late_minutes,
        MAX(CASE WHEN ci.\`FCheckinType\` = '2' THEN ci.\`FLeaveEarlyMinutes\` END) AS leave_early_minutes,
        COUNT(ci.\`FId\`) AS punch_count
      FROM ${U} u
      LEFT JOIN ${CI} ci
        ON ci.\`FUserId\` = u.${uId}
        AND ci.\`FPreOrReCheckInDate\` >= ? AND ci.\`FPreOrReCheckInDate\` < ?
      WHERE 1=1
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;

    const args: any[] = [month.start, month.end, '%MidECP-User%', '%service_user%'];

    sql += active.where;
    sql += wl.where;
    args.push(...wl.args);

    sql += ` GROUP BY u.${uId}, DATE(ci.\`FPreOrReCheckInDate\`)`;
    sql += ` ORDER BY u.${uName} ASC, checkin_date ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    const allDays = getAllDays(month.yyyy, month.mm);
    const workdays = await getTwWorkdays(month.yyyy, month.mm);
    const holidays = await getHolidayMap(month.yyyy, month.mm);

    type CiDay = {
      clock_in: string | null;
      clock_out: string | null;
      late_minutes: number | null;
      leave_early_minutes: number | null;
      punch_count: number;
    };
    type LeaveEntry = { leave_type: string | null; leave_hours: number };
    type PersonRecord = {
      person_id: string;
      display_name: string;
      department_id: string | null;
      days: Record<string, CiDay>;
      total_checkin_days: number;
      total_late_count: number;
      leaves: Record<string, LeaveEntry[]>;
    };

    const personMap = new Map<string, PersonRecord>();

    for (const row of rows) {
      const pid = String(row.person_id || '');
      const name = String(row.display_name ?? '').trim();
      if (!pid || !name) continue;

      if (!personMap.has(pid)) {
        personMap.set(pid, {
          person_id: pid,
          display_name: name,
          department_id: row.department_id ? String(row.department_id) : null,
          days: {},
          total_checkin_days: 0,
          total_late_count: 0,
          leaves: {}
        });
      }

      const dateStr = fmtDate(row.checkin_date);
      if (!dateStr) continue;
      const punchCount = Number(row.punch_count || 0);
      if (punchCount === 0) continue; // LEFT JOIN null row

      const p = personMap.get(pid)!;
      p.days[dateStr] = {
        clock_in: fmtTime(row.clock_in),
        clock_out: fmtTime(row.clock_out),
        late_minutes: row.late_minutes != null ? Number(row.late_minutes) : null,
        leave_early_minutes: row.leave_early_minutes != null ? Number(row.leave_early_minutes) : null,
        punch_count: punchCount
      };
    }

    // De-dupe by normalized display name (keep the one with more data)
    const seen = new Set<string>();
    const people: PersonRecord[] = [];
    for (const p of personMap.values()) {
      const nameKey = p.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (seen.has(nameKey)) {
        const idx = people.findIndex(
          (x) => x.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase() === nameKey
        );
        if (idx >= 0 && Object.keys(p.days).length > Object.keys(people[idx].days).length) {
          people[idx] = p;
        }
        continue;
      }
      seen.add(nameKey);
      people.push(p);
    }

    // Leave data query
    let leaveSql = `
      SELECT
        u.${uId} AS person_id,
        DATE(lp.\`FStartDate\`) AS leave_start_date,
        DATE(lp.\`FEndDate\`) AS leave_end_date,
        lp.\`FTotalHour\` AS total_hours,
        lp.\`FLeaveType2\` AS leave_type
      FROM ${U} u
      JOIN \`TcLeavePermit\` lp ON lp.\`FUserId\` = u.${uId}
      WHERE lp.\`FStartDate\` < ? AND lp.\`FEndDate\` >= ?
        AND lp.\`FStatus\` IN ('Audited','ActPAudited','PAudited')
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;
    const leaveArgs: any[] = [month.end, month.start, '%MidECP-User%', '%service_user%'];
    leaveSql += active.where;
    leaveSql += wl.where;
    leaveArgs.push(...wl.args);

    try {
      const leaveRows = await prisma.$queryRawUnsafe<any[]>(leaveSql, ...leaveArgs);
      // Build per-person per-date leave map
      const leaveMap = new Map<string, Map<string, { leave_type: string | null; leave_hours: number }[]>>();
      for (const row of leaveRows) {
        const pid = String(row.person_id || '');
        if (!pid) continue;
        const startStr = fmtDate(row.leave_start_date);
        const endStr = fmtDate(row.leave_end_date);
        if (!startStr || !endStr) continue;
        const totalHours = Number(row.total_hours || 0);
        const leaveType = row.leave_type ? String(row.leave_type).trim() : null;
        if (!leaveMap.has(pid)) leaveMap.set(pid, new Map());
        const personLeaves = leaveMap.get(pid)!;
        const start = new Date(startStr + 'T00:00:00');
        const end = new Date(endStr + 'T00:00:00');
        for (const dateStr of allDays) {
          const d = new Date(dateStr + 'T00:00:00');
          if (d >= start && d <= end) {
            if (!personLeaves.has(dateStr)) personLeaves.set(dateStr, []);
            personLeaves.get(dateStr)!.push({ leave_type: leaveType, leave_hours: totalHours });
          }
        }
      }
      // Attach leaves to people (match by person_id, also try to match users not in checkin data)
      for (const [pid, dayMap] of leaveMap.entries()) {
        // Find existing person or skip (only show leave for people already in the list)
        const person = people.find((p) => p.person_id === pid);
        if (person) {
          for (const [date, entries] of dayMap.entries()) {
            person.leaves[date] = entries;
          }
        }
      }
    } catch {
      // Leave data is optional — continue without it if query fails
    }

    // Compute totals
    for (const p of people) {
      let checkinDays = 0;
      let lateCount = 0;
      for (const date of workdays) {
        const ci = p.days[date];
        if (ci) {
          checkinDays++;
          if (ci.late_minutes != null && ci.late_minutes > 0) lateCount++;
        }
      }
      p.total_checkin_days = checkinDays;
      p.total_late_count = lateCount;
    }

    // Sort: least checkin days first
    people.sort((a, b) => a.total_checkin_days - b.total_checkin_days || a.display_name.localeCompare(b.display_name, 'zh-Hant'));

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      allDays,
      workdays,
      holidays,
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
