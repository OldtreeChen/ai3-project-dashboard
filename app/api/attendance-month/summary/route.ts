import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getUserActiveFilter } from '@/lib/userActive';
import { buildWhitelistWhere, getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { parseIdParam } from '../../_utils';

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

    const active = await getUserActiveFilter(m.tables.user, 'u');
    sql += active.where;

    const { dept1Id, dept2Id } = await getAiDeptIds();
    const wl = buildWhitelistWhere({
      uName: String(uName),
      uDeptId: uDeptId ? String(uDeptId) : null,
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id
    });
    sql += wl.where;
    args.push(...wl.args);

    sql += ` GROUP BY u.${uId}, DATE(th.${thWorkDate})`;
    sql += ` ORDER BY u.${uName} ASC, work_date ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    const allDays = getAllDays(month.yyyy, month.mm);
    const workdays = getWorkdays(month.yyyy, month.mm);
    const workdaySet = new Set(workdays);

    type PersonRecord = {
      person_id: string;
      display_name: string;
      department_id: string | null;
      days: Record<string, number>;
      total_reported_days: number;
      total_hours: number;
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
          total_hours: 0
        });
      }
      const p = personMap.get(pid)!;

      const dateStr = fmtDate(row.work_date);
      const hours = Number(row.hours || 0);
      if (dateStr) {
        p.days[dateStr] = (p.days[dateStr] || 0) + hours;
      }
    }

    // De-dupe
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
          const newScore = Object.values(p.days).reduce((a, b) => a + b, 0) + Object.keys(p.days).length;
          if (newScore > existingScore) people[idx] = p;
        }
        continue;
      }
      seen.add(key);
      people.push(p);
    }

    for (const p of people) {
      let reportedDays = 0;
      let totalHours = 0;
      for (const date of workdays) {
        const h = p.days[date] || 0;
        if (h > 0) reportedDays++;
        totalHours += h;
      }
      p.total_reported_days = reportedDays;
      p.total_hours = totalHours;
    }

    people.sort((a, b) => a.total_reported_days - b.total_reported_days || a.display_name.localeCompare(b.display_name, 'zh-Hant'));

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      allDays,
      workdays,
      filters: { departmentId: departmentId || null },
      people: people.map((p) => ({
        person_id: p.person_id,
        display_name: p.display_name,
        department_id: p.department_id,
        days: p.days,
        total_reported_days: p.total_reported_days,
        total_hours: Number(p.total_hours.toFixed(1))
      }))
    });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ? String(err.message) : 'unknown error' },
      { status: 500 }
    );
  }
}
