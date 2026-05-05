import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskReceivedAtColumn } from '@/lib/taskReceivedAt';
import { getUserActiveFilter } from '@/lib/userActive';
import { getTaskPlannedHoursColumn } from '@/lib/taskPlannedHours';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';
import { getTaskPlannedStartAtColumn } from '@/lib/taskPlannedStartAt';
import { buildWhitelistWhere, getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { getWorkdays as getTwWorkdays } from '@/lib/taiwanHolidays';
import { calDaysTotal, calDaysInMonth, toDateStrSafe } from '@/lib/workdayUtils';
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = parseMonthParam(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid month (expected YYYY-MM)' }, { status: 400 });

    const departmentId = parseIdParam(url.searchParams.get('departmentId'));
    const personId = parseIdParam(url.searchParams.get('personId'));

    const m = await getEcpMapping();
    const receivedAtCol = await getTaskReceivedAtColumn();
    const plannedHoursCol = await getTaskPlannedHoursColumn();
    const plannedStartCol = await getTaskPlannedStartAtColumn();
    const plannedEndCol = await getTaskPlannedEndAtColumn();

    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const TR = sqlId(m.tables.time);
    const U = sqlId(m.tables.user);
    const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;

    const tId = sqlId(m.task.id);
    const tProjectId = sqlId(m.task.projectId);
    const tAssigneeRaw = m.task.executorUserId || m.task.ownerUserId;
    const tAssignee = tAssigneeRaw ? sqlId(tAssigneeRaw) : null;
    const tPlanned = plannedHoursCol ? sqlId(plannedHoursCol) : (m.task.plannedHours ? sqlId(m.task.plannedHours) : null);
    const tReceivedAt = sqlId(receivedAtCol);
    const tPlanStart = plannedStartCol ? sqlId(plannedStartCol) : null;
    const tPlanEnd = plannedEndCol ? sqlId(plannedEndCol) : null;
    const tStatus = m.task.status ? sqlId(m.task.status) : null;

    const trTaskId = sqlId(m.time.taskId);
    const trUserId = sqlId(m.time.userId);
    const trHours = sqlId(m.time.hours);
    const trTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;
    const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
    const thWorkDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

    const pId = sqlId(m.project.id);
    const pName = sqlId(m.project.name);

    if (!tAssignee) {
      return Response.json(
        { error: 'task.executorUserId/ownerUserId is not mapped' },
        { status: 500 }
      );
    }
    if (!(TH && trTimeReportId && thId && thWorkDate)) {
      return Response.json({ error: 'timeReport mapping missing' }, { status: 500 });
    }

    const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';
    const startExpr = tPlanStart ? `COALESCE(t.${tPlanStart}, t.${tReceivedAt})` : `t.${tReceivedAt}`;
    const endExpr = tPlanEnd ? `COALESCE(t.${tPlanEnd}, t.${tReceivedAt})` : `t.${tReceivedAt}`;

    // ── Query 1: users LEFT JOIN task raw data (no SQL proration) ──
    let sql = `
      SELECT
        u.${uId}   AS person_id,
        u.${uName} AS display_name,
        ${uDeptId ? `u.${uDeptId}` : 'NULL'} AS department_id,
        ti.task_id,
        ti.raw_planned_hours,
        ti.plan_start,
        ti.plan_end,
        COALESCE(us.used_hours, 0) AS used_hours
      FROM ${U} u
      LEFT JOIN (
        SELECT
          t.${tId} AS task_id,
          t.${tAssignee} AS person_id,
          ${plannedExpr} AS raw_planned_hours,
          DATE(${startExpr}) AS plan_start,
          DATE(${endExpr})   AS plan_end
        FROM ${T} t
        LEFT JOIN ${P} p ON p.${pId} = t.${tProjectId}
        WHERE t.${tAssignee} IS NOT NULL AND t.${tAssignee} <> ''
          ${tStatus ? `AND (t.${tStatus} IS NULL OR t.${tStatus} NOT IN ('Discarded','Cancel'))` : ''}
          AND p.${pName} NOT LIKE ?
          AND DATE(${startExpr}) < DATE(?)
          AND DATE(${endExpr}) >= DATE(?)
      ) ti ON ti.person_id = u.${uId}
      LEFT JOIN (
        SELECT tr.${trTaskId} AS task_id, tr.${trUserId} AS person_id,
               COALESCE(SUM(tr.${trHours}), 0) AS used_hours
        FROM ${TR} tr
        LEFT JOIN ${TH} th ON th.${thId} = tr.${trTimeReportId}
        WHERE th.${thWorkDate} >= ? AND th.${thWorkDate} < ?
        GROUP BY tr.${trTaskId}, tr.${trUserId}
      ) us ON us.task_id = ti.task_id AND us.person_id = u.${uId}
      WHERE 1=1
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;

    const args: any[] = [
      '%新人%', month.end, month.start,   // task subquery
      month.start, month.end,              // used hours subquery
      '%MidECP-User%', '%service_user%',  // user filters
    ];

    const active = await getUserActiveFilter(m.tables.user, 'u');
    sql += active.where;

    const { dept1Id, dept2Id } = await getAiDeptIds();
    const wl = buildWhitelistWhere({
      uName: String(uName),
      uDeptId: uDeptId ? String(uDeptId) : null,
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id,
      scope: 'dept-month',
    });
    sql += wl.where;
    args.push(...wl.args);

    if (personId) {
      sql += ` AND u.${uId} = ?`;
      args.push(personId);
    }

    sql += ` ORDER BY u.${uName} ASC, ti.plan_start ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // ── Workday-based proration in JS ──────────────────────────────────────
    const workdays = await getTwWorkdays(month.yyyy, month.mm);

    type PersonAgg = {
      person_id: string;
      display_name: string;
      department_id: string | null;
      task_count: number;
      received_total_hours: number;
      used_hours: number;
    };

    const personMap = new Map<string, PersonAgg>();

    for (const row of rows) {
      const pid = String(row.person_id || '');
      const name = String(row.display_name ?? '').trim();
      if (!pid || !name) continue;

      if (!personMap.has(pid)) {
        personMap.set(pid, {
          person_id: pid,
          display_name: name,
          department_id: row.department_id ? String(row.department_id) : null,
          task_count: 0,
          received_total_hours: 0,
          used_hours: 0,
        });
      }

      const p = personMap.get(pid)!;

      if (row.task_id != null) {
        const planStart = toDateStrSafe(row.plan_start);
        const planEnd = toDateStrSafe(row.plan_end);
        if (planStart && planEnd) {
          const taskTotalDays = calDaysTotal(planStart, planEnd);
          const overlapDays = calDaysInMonth(planStart, planEnd, month.start, month.end);
          const allocatedHours = Number(row.raw_planned_hours || 0) * overlapDays / taskTotalDays;
          p.task_count++;
          p.received_total_hours += allocatedHours;
        }
        p.used_hours += Number(row.used_hours || 0);
      }
    }

    // De-dupe by normalized display name
    const seen = new Set<string>();
    const people: any[] = [];
    for (const p of personMap.values()) {
      const key = p.display_name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const recv = Math.round(p.received_total_hours * 10) / 10;
      const used = Math.round(p.used_hours * 10) / 10;
      people.push({
        ...p,
        received_total_hours: recv,
        used_hours: used,
        remaining_hours: Math.round((recv - used) * 10) / 10,
      });
    }

    // Sort: most remaining first
    people.sort((a, b) =>
      b.remaining_hours - a.remaining_hours ||
      b.received_total_hours - a.received_total_hours ||
      a.display_name.localeCompare(b.display_name, 'zh-Hant')
    );

    void P; void tProjectId;

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      workday_count: workdays.length,
      received_at_column: { table: m.tables.task, column: receivedAtCol },
      planned_hours_column: { table: m.tables.task, column: plannedHoursCol },
      planned_start_column: { table: m.tables.task, column: plannedStartCol },
      planned_end_column: { table: m.tables.task, column: plannedEndCol },
      allocation: { method: 'overlap_calendar_days / total_calendar_days', unit: 'days', note: '接收總時數=該月任務預估（日曆天均攤）' },
      filters: { departmentId: departmentId || null, personId: personId || null },
      people,
    });
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: err?.message ? String(err.message) : 'unknown error',
        hint: [
          '通常是「接收日期欄位」偵測不到，或 ecp.columns 對應需要在 config.json 明確指定。',
          '{ "ecp": { "columns": { "task": { "receivedAt": "FFirstCommitmentDate" }}}}'
        ],
      },
      { status: 500 }
    );
  }
}
