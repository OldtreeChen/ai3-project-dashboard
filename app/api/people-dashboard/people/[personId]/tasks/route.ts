import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { parseDateParam } from '../../../../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ personId: string }> }) {
  const { personId } = await ctx.params;
  if (!personId) return Response.json({ error: 'invalid personId' }, { status: 400 });

  const url = new URL(req.url);
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));
  if (!(from && to)) return Response.json({ error: 'from/to required (YYYY-MM-DD)' }, { status: 400 });

  const m = await getEcpMapping();
  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);
  const TD = sqlId(m.tables.time);
  const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;

  const pId = sqlId(m.project.id);
  const pCode = m.project.code ? sqlId(m.project.code) : null;
  const pName = sqlId(m.project.name);

  const tId = sqlId(m.task.id);
  const tProjectId = sqlId(m.task.projectId);
  const tName = sqlId(m.task.name);
  const tStatus = m.task.status ? sqlId(m.task.status) : null;

  const tdTaskId = sqlId(m.time.taskId);
  const tdUserId = sqlId(m.time.userId);
  const tdHours = sqlId(m.time.hours);
  const tdTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;

  const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
  const thDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

  if (!(TH && thId && thDate && tdTimeReportId)) {
    return Response.json({ error: 'timeReport/timeDetail mapping missing (need timeReportId + workDate)' }, { status: 500 });
  }

  const sql = `
    SELECT
      t.${tId} AS task_id,
      t.${tName} AS task_name,
      ${tStatus ? `t.${tStatus} AS task_status,` : `NULL AS task_status,`}
      p.${pId} AS project_id,
      ${pCode ? `p.${pCode} AS project_code,` : `NULL AS project_code,`}
      p.${pName} AS project_name,
      COALESCE(SUM(td.${tdHours}), 0) AS hours
    FROM ${TD} td
    JOIN ${TH} th ON th.${thId} = td.${tdTimeReportId}
    JOIN ${T} t ON t.${tId} = td.${tdTaskId}
    LEFT JOIN ${P} p ON p.${pId} = t.${tProjectId}
    WHERE td.${tdUserId} = ?
      AND th.${thDate} BETWEEN ? AND ?
    GROUP BY t.${tId}, p.${pId}
    ORDER BY hours DESC, t.${tId} DESC
  `;

  const tasks = await prisma.$queryRawUnsafe<any[]>(sql, personId, from, to);
  return Response.json({ personId, date_filter: { from, to }, tasks });
}


