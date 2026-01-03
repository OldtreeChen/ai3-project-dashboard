import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
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

  const tdTaskId = sqlId(m.time.taskId);
  const tdUserId = sqlId(m.time.userId);
  const tdHours = sqlId(m.time.hours);
  const tdTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;

  const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
  const thDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  if (!TH || !thId || !thDate || !tdTimeReportId) {
    return Response.json({ error: 'timeReport/timeDetail mapping missing (need timeReportId + workDate)' }, { status: 500 });
  }

  let sql = `
    SELECT
      pe.${uId} AS person_id,
      pe.${uName} AS display_name,
      t.${tId} AS task_id,
      t.${tName} AS task_name,
      COALESCE(SUM(td.${tdHours}), 0) AS hours
    FROM ${TD} td
    JOIN ${TH} th ON th.${thId} = td.${tdTimeReportId}
    JOIN ${U} pe ON pe.${uId} = td.${tdUserId}
    JOIN ${T} t ON t.${tId} = td.${tdTaskId}
    WHERE t.${tProjectId} = ?
  `;
  const args: Array<string> = [projectId];

  if (from && to) {
    sql += ` AND th.${thDate} BETWEEN ? AND ?`;
    args.push(from, to);
  }
  if (personId) {
    sql += ` AND td.${tdUserId} = ?`;
    args.push(personId);
  }
  if (departmentId && uDeptId) {
    sql += ` AND pe.${uDeptId} = ?`;
    args.push(departmentId);
  }

  sql += `
    GROUP BY pe.${uId}, t.${tId}
    ORDER BY pe.${uName} ASC, t.${tId} ASC
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

  return Response.json({
    date_filter: from && to ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    rows
  });
}



