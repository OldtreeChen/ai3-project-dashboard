import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string; personId: string }> }) {
  const { projectId, personId } = await ctx.params;
  if (!projectId) return Response.json({ error: 'invalid projectId' }, { status: 400 });
  if (!personId) return Response.json({ error: 'invalid personId' }, { status: 400 });

  const m = await getEcpMapping();
  const T = sqlId(m.tables.task);
  const U = sqlId(m.tables.user);

  const tId = sqlId(m.task.id);
  const tProjectId = sqlId(m.task.projectId);
  const tName = sqlId(m.task.name);
  const tStatus = m.task.status ? sqlId(m.task.status) : null;
  const tPlanned = m.task.plannedHours ? sqlId(m.task.plannedHours) : null;
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;
  const planEndCol = await getTaskPlannedEndAtColumn();
  const tPlanEnd = planEndCol ? sqlId(planEndCol) : (m.task.plannedEndAt ? sqlId(m.task.plannedEndAt) : null);
  const tCompleted = m.task.completedAt ? sqlId(m.task.completedAt) : null;
  const tExecutor = m.task.executorUserId ? sqlId(m.task.executorUserId) : (m.task.ownerUserId ? sqlId(m.task.ownerUserId) : null);

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';
  const actualExpr = tHours ? `COALESCE(t.${tHours}, 0)` : '0';

  if (!tExecutor) return Response.json({ error: 'task.executorUserId is not mapped' }, { status: 500 });

  const sql = `
    SELECT
      t.${tId} AS task_id,
      t.${tName} AS task_name,
      u.${uName} AS executor_name,
      ${tStatus ? `t.${tStatus} AS task_status,` : `NULL AS task_status,`}
      ${plannedExpr} AS task_planned_hours,
      ${actualExpr} AS actual_hours,
      (${plannedExpr} - ${actualExpr}) AS remaining_hours,
      ${tPlanEnd ? `t.${tPlanEnd} AS planned_end_at,` : `NULL AS planned_end_at,`}
      ${tCompleted ? `t.${tCompleted} AS completed_at` : `NULL AS completed_at`}
    FROM ${T} t
    LEFT JOIN ${U} u ON u.${uId} = t.${tExecutor}
    WHERE t.${tProjectId} = ?
      AND t.${tExecutor} = ?
    ORDER BY
      ${tPlanEnd ? `planned_end_at DESC,` : ''}
      t.${tId} DESC
  `;

  const tasks = await prisma.$queryRawUnsafe<any[]>(sql, projectId, personId);
  return Response.json({ projectId, personId, tasks });
}


