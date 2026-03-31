import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getUserActiveFilter } from '@/lib/userActive';
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
  const U = sqlId(m.tables.user);

  const tId = sqlId(m.task.id);
  const tProjectId = sqlId(m.task.projectId);
  const tExecutor = m.task.executorUserId ? sqlId(m.task.executorUserId) : (m.task.ownerUserId ? sqlId(m.task.ownerUserId) : null);
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  // exclude disabled/deleted users
  const active = await getUserActiveFilter(m.tables.user, 'u');

  // 依「任務本身的 actualHours」做彙總（不受日期篩選影響）
  const hoursExpr = tHours ? `COALESCE(SUM(t.${tHours}), 0)` : '0';
  let sql = `
    SELECT
      ${tExecutor ? `t.${tExecutor} AS person_id,` : `NULL AS person_id,`}
      ${tExecutor ? `u.${uName} AS display_name,` : `NULL AS display_name,`}
      ${hoursExpr} AS hours,
      COUNT(1) AS task_count
    FROM ${T} t
    ${tExecutor ? `LEFT JOIN ${U} u ON u.${uId} = t.${tExecutor}` : ''}
    WHERE t.${tProjectId} = ?
      ${tExecutor ? active.where : ''}
      ${personId && tExecutor ? `AND t.${tExecutor} = ?` : ''}
      ${departmentId && uDeptId && tExecutor ? `AND u.${uDeptId} = ?` : ''}
    GROUP BY ${tExecutor ? `t.${tExecutor}` : 't.' + tId}
    ORDER BY hours DESC, display_name ASC
  `;
  const args: Array<string> = [projectId];
  if (personId && tExecutor) args.push(personId);
  if (departmentId && uDeptId && tExecutor) args.push(departmentId);

  const people = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

  // normalize BigInt/Decimal-ish values for JSON safety
  const normalized = (people || []).map((r) => ({
    ...r,
    hours: Number(r.hours || 0),
    task_count: Number(r.task_count || 0)
  }));

  return Response.json({
    date_filter: from && to ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    people: normalized
  });
}


