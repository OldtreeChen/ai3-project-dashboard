import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';
import { parseDateParam, parseIdParam } from '../../../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId: projectIdRaw } = await ctx.params;
  const projectId = projectIdRaw;
  if (!projectId) return Response.json({ error: 'invalid projectId' }, { status: 400 });

  const url = new URL(req.url);
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));
  const personId = parseIdParam(url.searchParams.get('personId'));
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));

  const m = await getEcpMapping();
  const T = sqlId(m.tables.task);
  const TD = sqlId(m.tables.time);
  const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;
  const U = sqlId(m.tables.user);

  const tId = sqlId(m.task.id);
  const tProjectId = sqlId(m.task.projectId);
  const tName = sqlId(m.task.name);
  const tPlanned = m.task.plannedHours ? sqlId(m.task.plannedHours) : null;
  const tStatus = m.task.status ? sqlId(m.task.status) : null;
  const tExecutor = m.task.executorUserId ? sqlId(m.task.executorUserId) : (m.task.ownerUserId ? sqlId(m.task.ownerUserId) : null);
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;
  const planEndCol = await getTaskPlannedEndAtColumn();
  const tPlanEnd = planEndCol ? sqlId(planEndCol) : (m.task.plannedEndAt ? sqlId(m.task.plannedEndAt) : null);
  const tCompleted = m.task.completedAt ? sqlId(m.task.completedAt) : null;

  const tdTaskId = sqlId(m.time.taskId);
  const tdUserId = sqlId(m.time.userId);
  const tdHours = sqlId(m.time.hours);
  const tdTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;

  const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
  const thDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';
  const actualExpr = tHours ? `COALESCE(t.${tHours}, 0)` : '0';

  // 舊版：用工時填報彙總（保留 reported_hours，方便對照）
  const reportedSubquery = `
    SELECT
      te.${tdTaskId} AS task_id,
      COALESCE(SUM(te.${tdHours}), 0) AS reported_hours
    FROM ${TD} te
    ${TH && thId && thDate && tdTimeReportId ? `LEFT JOIN ${TH} th ON th.${thId} = te.${tdTimeReportId}` : ''}
    WHERE 1=1
      ${from && to && TH && thId && thDate && tdTimeReportId ? `AND th.${thDate} BETWEEN ? AND ?` : ''}
    GROUP BY te.${tdTaskId}
  `;

  let sql = `
    SELECT
      t.${tId} AS task_id,
      t.${tName} AS task_name,
      ${tExecutor ? `t.${tExecutor} AS executor_user_id,` : `NULL AS executor_user_id,`}
      ${tExecutor ? `execu.${uName} AS executor_name,` : `NULL AS executor_name,`}
      ${tStatus ? `t.${tStatus} AS task_status,` : `NULL AS task_status,`}
      ${plannedExpr} AS task_planned_hours,
      ${actualExpr} AS actual_hours,
      COALESCE(x.reported_hours, 0) AS reported_hours,
      (${plannedExpr} - ${actualExpr}) AS remaining_hours,
      ${tPlanEnd ? `t.${tPlanEnd} AS planned_end_at,` : `NULL AS planned_end_at,`}
      ${tCompleted ? `t.${tCompleted} AS completed_at` : `NULL AS completed_at`}
    FROM ${T} t
    ${tExecutor ? `LEFT JOIN ${U} execu ON execu.${uId} = t.${tExecutor}` : ''}
    LEFT JOIN (
      ${reportedSubquery}
    ) x ON x.task_id = t.${tId}
    WHERE t.${tProjectId} = ?
      ${personId && tExecutor ? `AND t.${tExecutor} = ?` : ''}
    ORDER BY
      ${tPlanEnd ? `planned_end_at DESC,` : ''}
      t.${tId} DESC
  `;

  const args: Array<string> = [];
  if (from && to && TH && thId && thDate && tdTimeReportId) args.push(from, to);
  args.push(projectId);
  if (personId && tExecutor) args.push(personId);

  const tasks = await prisma.$queryRawUnsafe<
    Array<{
      task_id: number;
      task_name: string;
      task_planned_hours: number;
      task_status: string;
      actual_hours: number;
      reported_hours: number;
      remaining_hours: number;
      executor_user_id: string | number | null;
      executor_name: string | null;
      planned_end_at: string | null;
      completed_at: string | null;
    }>
  >(sql, ...args);

  return Response.json({
    date_filter: from && to ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    tasks
  });
}


