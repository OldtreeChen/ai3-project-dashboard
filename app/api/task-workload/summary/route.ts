import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskReceivedAtColumn } from '@/lib/taskReceivedAt';
import { getTaskPlannedHoursColumn } from '@/lib/taskPlannedHours';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';
import { getTaskPlannedStartAtColumn } from '@/lib/taskPlannedStartAt';
import { getUserActiveFilter } from '@/lib/userActive';
import { buildWhitelistWhere, getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { getWorkdays as getTwWorkdays, getHolidayMap } from '@/lib/taiwanHolidays';
import { countWeekdays } from '@/lib/workdayUtils';
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
  const days: string[] = [];
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${yyyy}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

function toDateStr(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}


export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = parseMonthParam(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid month (expected YYYY-MM)' }, { status: 400 });

    const departmentId = parseIdParam(url.searchParams.get('departmentId'));

    const m = await getEcpMapping();
    const receivedAtCol = await getTaskReceivedAtColumn();
    const plannedHoursCol = await getTaskPlannedHoursColumn();
    const plannedStartCol = await getTaskPlannedStartAtColumn();
    const plannedEndCol = await getTaskPlannedEndAtColumn();

    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const U = sqlId(m.tables.user);

    const tId = sqlId(m.task.id);
    const tName = sqlId(m.task.name);
    const tProjectId = sqlId(m.task.projectId);
    const tAssigneeRaw = m.task.executorUserId || m.task.ownerUserId;
    const tAssignee = tAssigneeRaw ? sqlId(tAssigneeRaw) : null;
    const tPlanned = plannedHoursCol ? sqlId(plannedHoursCol) : (m.task.plannedHours ? sqlId(m.task.plannedHours) : null);
    const tStatus = m.task.status ? sqlId(m.task.status) : null;
    const tReceivedAt = sqlId(receivedAtCol);

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

    const pId = sqlId(m.project.id);
    const pCode = m.project.code ? sqlId(m.project.code) : null;
    const pName = sqlId(m.project.name);

    if (!tAssignee) {
      return Response.json({ error: 'task.executorUserId/ownerUserId not mapped' }, { status: 500 });
    }

    const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';
    const startExpr = plannedStartCol ? `COALESCE(t.${sqlId(plannedStartCol)}, t.${tReceivedAt})` : `t.${tReceivedAt}`;
    const endExpr = plannedEndCol ? `COALESCE(t.${sqlId(plannedEndCol)}, t.${tReceivedAt})` : `t.${tReceivedAt}`;

    let sql = `
      SELECT
        u.${uId}   AS person_id,
        u.${uName} AS display_name,
        t.${tId}   AS task_id,
        t.${tName} AS task_name,
        ${plannedExpr} AS planned_hours,
        DATE(${startExpr}) AS plan_start,
        DATE(${endExpr})   AS plan_end,
        ${pCode ? `p.${pCode}` : 'NULL'} AS project_code,
        p.${pName} AS project_name
      FROM ${T} t
      JOIN ${U} u ON u.${uId} = t.${tAssignee}
      LEFT JOIN ${P} p ON p.${pId} = t.${tProjectId}
      WHERE t.${tAssignee} IS NOT NULL AND t.${tAssignee} <> ''
        ${tStatus ? `AND (t.${tStatus} IS NULL OR t.${tStatus} NOT IN ('Discarded','Cancel'))` : ''}
        AND p.${pName} NOT LIKE ?
        AND DATE(${startExpr}) < DATE(?)
        AND DATE(${endExpr}) >= DATE(?)
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;

    const args: any[] = ['%新人%', month.end, month.start, '%MidECP-User%', '%service_user%'];

    const active = await getUserActiveFilter(m.tables.user, 'u');
    sql += active.where;

    const { dept1Id, dept2Id, allDeptIds } = await getAiDeptIds();
    const wl = buildWhitelistWhere({
      uName: String(uName),
      uDeptId: uDeptId ? String(uDeptId) : null,
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id,
      allDeptIds,
      scope: 'dept-month',
    });
    sql += wl.where;
    args.push(...wl.args);

    sql += ` ORDER BY u.${uName} ASC, t.${tId} ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // ── Build per-person per-day workload ──────────────────────────────────
    const allDays = getAllDays(month.yyyy, month.mm);
    const workdays = await getTwWorkdays(month.yyyy, month.mm);
    const holidays = await getHolidayMap(month.yyyy, month.mm);
    const workdaySet = new Set(workdays);

    type TaskChunk = { task_id: string; task_name: string; project_code: string | null; project_name: string | null; hours: number };
    type DayLoad = { hours: number; tasks: TaskChunk[] };
    type PersonRecord = {
      person_id: string;
      display_name: string;
      total_month_hours: number;
      task_count: number;
      days: Record<string, DayLoad>;
    };

    const personMap = new Map<string, PersonRecord>();

    for (const row of rows) {
      const pid = String(row.person_id || '');
      const name = String(row.display_name ?? '').trim();
      if (!pid || !name) continue;

      const planStart = toDateStr(row.plan_start);
      const planEnd = toDateStr(row.plan_end);
      if (!planStart || !planEnd) continue;

      const plannedHours = Number(row.planned_hours || 0);
      if (plannedHours <= 0) continue;

      // Find workdays in task's full range
      const taskWorkdays = countWeekdays(planStart, planEnd);
      const hoursPerDay = plannedHours / taskWorkdays;

      // Find month workdays that fall within this task's range
      const monthDaysInTask = workdays.filter((d) => d >= planStart && d <= planEnd);
      if (monthDaysInTask.length === 0) continue;

      if (!personMap.has(pid)) {
        personMap.set(pid, {
          person_id: pid,
          display_name: name,
          total_month_hours: 0,
          task_count: 0,
          days: {},
        });
      }
      const person = personMap.get(pid)!;

      const taskChunk: TaskChunk = {
        task_id: String(row.task_id || ''),
        task_name: String(row.task_name ?? ''),
        project_code: row.project_code ? String(row.project_code) : null,
        project_name: row.project_name ? String(row.project_name) : null,
        hours: Math.round(hoursPerDay * 10) / 10,
      };

      for (const day of monthDaysInTask) {
        if (!person.days[day]) {
          person.days[day] = { hours: 0, tasks: [] };
        }
        person.days[day].hours += hoursPerDay;
        person.days[day].tasks.push(taskChunk);
      }
      person.total_month_hours += monthDaysInTask.length * hoursPerDay;
      person.task_count++;
    }

    // De-dupe by normalized display name
    const seen = new Set<string>();
    const people: PersonRecord[] = [];
    for (const p of personMap.values()) {
      const key = p.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Round day totals
      for (const day of Object.keys(p.days)) {
        p.days[day].hours = Math.round(p.days[day].hours * 10) / 10;
      }
      p.total_month_hours = Math.round(p.total_month_hours * 10) / 10;
      people.push(p);
    }

    // Sort by total month hours desc
    people.sort((a, b) => b.total_month_hours - a.total_month_hours || a.display_name.localeCompare(b.display_name, 'zh-Hant'));

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      allDays,
      workdays,
      holidays,
      workday_count: workdays.length,
      people,
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message ? String(err.message) : 'unknown error' }, { status: 500 });
  }
}
