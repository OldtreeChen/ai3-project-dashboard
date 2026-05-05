import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskReceivedAtColumn } from '@/lib/taskReceivedAt';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';
import { getTaskPlannedHoursColumn } from '@/lib/taskPlannedHours';
import { getTaskPlannedStartAtColumn } from '@/lib/taskPlannedStartAt';
import { calDaysTotal, calDaysInMonth, toDateStrSafe } from '@/lib/workdayUtils';

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

export async function GET(req: Request, ctx: { params: Promise<{ personId: string }> }) {
  try {
    const { personId: personIdRaw } = await ctx.params;
    const personId = String(personIdRaw || '').trim();
    if (!personId) return Response.json({ error: 'invalid personId' }, { status: 400 });

    const url = new URL(req.url);
    const month = parseMonthParam(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid month (expected YYYY-MM)' }, { status: 400 });

    const m = await getEcpMapping();
    const receivedAtCol = await getTaskReceivedAtColumn();
    const plannedEndCol = await getTaskPlannedEndAtColumn();
    const plannedHoursCol = await getTaskPlannedHoursColumn();
    const plannedStartCol = await getTaskPlannedStartAtColumn();

    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const TR = sqlId(m.tables.time);
    const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;

    const pId = sqlId(m.project.id);
    const pCode = m.project.code ? sqlId(m.project.code) : null;
    const pName = sqlId(m.project.name);

    const tId = sqlId(m.task.id);
    const tProjectId = sqlId(m.task.projectId);
    const tName = sqlId(m.task.name);
    const tAssigneeRaw = m.task.executorUserId || m.task.ownerUserId;
    const tAssignee = tAssigneeRaw ? sqlId(tAssigneeRaw) : null;
    const tPlanned = plannedHoursCol ? sqlId(plannedHoursCol) : (m.task.plannedHours ? sqlId(m.task.plannedHours) : null);
    const tStatus = m.task.status ? sqlId(m.task.status) : null;
    const tReceivedAt = sqlId(receivedAtCol);
    const tPlannedEndAt = plannedEndCol ? sqlId(plannedEndCol) : null;
    const tPlannedStartAt = plannedStartCol ? sqlId(plannedStartCol) : null;
    const tCompletedAt = m.task.completedAt ? sqlId(m.task.completedAt) : null;

    const trTaskId = sqlId(m.time.taskId);
    const trUserId = sqlId(m.time.userId);
    const trHours = sqlId(m.time.hours);
    const trTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;
    const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
    const thWorkDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

    if (!tAssignee) {
      return Response.json({ error: 'task.executorUserId/ownerUserId is not mapped' }, { status: 500 });
    }
    if (!(TH && trTimeReportId && thId && thWorkDate)) {
      return Response.json({ error: 'timeReport mapping missing' }, { status: 500 });
    }

    const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';
    const startExpr = tPlannedStartAt ? `COALESCE(t.${tPlannedStartAt}, t.${tReceivedAt})` : `t.${tReceivedAt}`;
    const endExpr = tPlannedEndAt ? `COALESCE(t.${tPlannedEndAt}, t.${tReceivedAt})` : `t.${tReceivedAt}`;

    if (!(TH && trTimeReportId && thId && thWorkDate)) {
      return Response.json({ error: 'timeReport/timeDetail mapping missing' }, { status: 500 });
    }
    const usedSql = `
      SELECT tr.${trTaskId} AS task_id, tr.${trUserId} AS person_id,
             COALESCE(SUM(tr.${trHours}), 0) AS used_hours
      FROM ${TR} tr
      LEFT JOIN ${TH} th ON th.${thId} = tr.${trTimeReportId}
      WHERE th.${thWorkDate} >= ? AND th.${thWorkDate} < ?
      GROUP BY tr.${trTaskId}, tr.${trUserId}
    `;

    const sql = `
      SELECT
        t.${tId} AS task_id,
        t.${tName} AS task_name,
        ${tStatus ? `t.${tStatus} AS task_status,` : `NULL AS task_status,`}
        t.${tReceivedAt} AS received_at,
        ${plannedExpr} AS raw_planned_hours,
        DATE(${startExpr}) AS plan_start,
        DATE(${endExpr})   AS plan_end,
        ${tPlannedEndAt ? `t.${tPlannedEndAt} AS planned_end_at,` : `NULL AS planned_end_at,`}
        ${tCompletedAt ? `t.${tCompletedAt} AS completed_at,` : `NULL AS completed_at,`}
        COALESCE(us.used_hours, 0) AS used_hours,
        t.${tProjectId} AS project_id,
        ${pCode ? `p.${pCode} AS project_code,` : `NULL AS project_code,`}
        p.${pName} AS project_name
      FROM ${T} t
      LEFT JOIN (${usedSql}) us ON us.task_id = t.${tId} AND us.person_id = ?
      LEFT JOIN ${P} p ON p.${pId} = t.${tProjectId}
      WHERE t.${tAssignee} = ?
        ${tStatus ? `AND (t.${tStatus} IS NULL OR t.${tStatus} NOT IN ('Discarded','Cancel'))` : ''}
        AND DATE(${startExpr}) < DATE(?)
        AND DATE(${endExpr}) >= DATE(?)
        AND p.${pName} NOT LIKE ?
      ORDER BY t.${tReceivedAt} DESC, t.${tId} DESC
    `;

    const args: any[] = [
      month.start, month.end,  // used hours subquery
      personId,                // us join
      personId,                // WHERE assignee
      month.end, month.start,  // overlap
      '%新人%',               // project filter
    ];

    const tasks = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // Calendar-day proration in JS
    const normalized = tasks.map((t) => {
      const planStart = toDateStrSafe(t.plan_start);
      const planEnd = toDateStrSafe(t.plan_end);
      const rawHours = Number(t.raw_planned_hours || 0);
      let planned_hours = 0;
      if (planStart && planEnd) {
        const taskTotalDays = calDaysTotal(planStart, planEnd);
        const overlapDays = calDaysInMonth(planStart, planEnd, month.start, month.end);
        planned_hours = rawHours * overlapDays / taskTotalDays;
      }
      const used = Number(t.used_hours || 0);
      return {
        task_id: t.task_id,
        task_name: t.task_name,
        task_status: t.task_status,
        received_at: t.received_at,
        planned_hours: Math.round(planned_hours * 10) / 10,
        planned_end_at: t.planned_end_at,
        completed_at: t.completed_at,
        used_hours: Math.round(used * 10) / 10,
        remaining_hours: Math.round((planned_hours - used) * 10) / 10,
        project_id: t.project_id,
        project_code: t.project_code,
        project_name: t.project_name,
      };
    });

    return Response.json({
      personId,
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      received_at_column: { table: m.tables.task, column: receivedAtCol },
      allocation: { method: 'overlap_calendar_days / total_calendar_days', unit: 'days' },
      tasks: normalized,
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
