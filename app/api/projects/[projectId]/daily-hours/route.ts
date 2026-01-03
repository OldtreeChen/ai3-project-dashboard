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
  if (!(from && to)) return Response.json({ error: 'from/to required (YYYY-MM-DD)' }, { status: 400 });

  const personId = parseIdParam(url.searchParams.get('personId'));
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));

  const m = await getEcpMapping();
  const T = sqlId(m.tables.task);
  const TD = sqlId(m.tables.time);
  const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;
  const U = sqlId(m.tables.user);

  const tId = sqlId(m.task.id);
  const tProjectId = sqlId(m.task.projectId);

  const tdTaskId = sqlId(m.time.taskId);
  const tdUserId = sqlId(m.time.userId);
  const tdHours = sqlId(m.time.hours);
  const tdTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;

  const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
  const thDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

  const uId = sqlId(m.user.id);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  if (!(TH && thId && thDate && tdTimeReportId)) {
    return Response.json({ error: 'timeReport/timeDetail mapping missing (need timeReportId + workDate)' }, { status: 500 });
  }

  let sql = `
    SELECT
      th.${thDate} AS date,
      COALESCE(SUM(td.${tdHours}), 0) AS hours
    FROM ${TD} td
    JOIN ${TH} th ON th.${thId} = td.${tdTimeReportId}
    JOIN ${T} t ON t.${tId} = td.${tdTaskId}
    JOIN ${U} pe ON pe.${uId} = td.${tdUserId}
    WHERE t.${tProjectId} = ?
      AND th.${thDate} BETWEEN ? AND ?
  `;
  const args: Array<string> = [projectId, from, to];

  if (personId) {
    sql += ` AND td.${tdUserId} = ?`;
    args.push(personId);
  }
  if (departmentId && uDeptId) {
    sql += ` AND pe.${uDeptId} = ?`;
    args.push(departmentId);
  }

  sql += `
    GROUP BY th.${thDate}
    ORDER BY th.${thDate} ASC
  `;

  const rows = await prisma.$queryRawUnsafe<Array<{ date: string; hours: number }>>(sql, ...args);

  return Response.json({
    date_filter: { from, to },
    filters: { personId: personId || null, departmentId: departmentId || null },
    rows
  });
}



