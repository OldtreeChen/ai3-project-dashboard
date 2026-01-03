import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { parseDateParam, parseIdParam } from '../../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = parseDateParam(url.searchParams.get('from'));
  const to = parseDateParam(url.searchParams.get('to'));
  if (!(from && to)) return Response.json({ error: 'from/to required (YYYY-MM-DD)' }, { status: 400 });

  const departmentId = parseIdParam(url.searchParams.get('departmentId'));

  const m = await getEcpMapping();
  const TD = sqlId(m.tables.time);
  const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;
  const U = sqlId(m.tables.user);

  const tdUserId = sqlId(m.time.userId);
  const tdHours = sqlId(m.time.hours);
  const tdTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;

  const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
  const thDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  if (!(TH && thId && thDate && tdTimeReportId)) {
    return Response.json({ error: 'timeReport/timeDetail mapping missing (need timeReportId + workDate)' }, { status: 500 });
  }

  let sql = `
    SELECT
      u.${uId} AS person_id,
      u.${uName} AS display_name,
      COALESCE(SUM(td.${tdHours}), 0) AS hours,
      COUNT(DISTINCT td.${tdTimeReportId}) AS report_count
    FROM ${TD} td
    JOIN ${TH} th ON th.${thId} = td.${tdTimeReportId}
    JOIN ${U} u ON u.${uId} = td.${tdUserId}
    WHERE th.${thDate} BETWEEN ? AND ?
  `;
  const args: string[] = [from, to];

  if (departmentId && uDeptId) {
    sql += ` AND u.${uDeptId} = ?`;
    args.push(departmentId);
  }

  sql += `
    GROUP BY u.${uId}
    ORDER BY hours DESC, display_name ASC
  `;

  const people = await prisma.$queryRawUnsafe<any[]>(sql, ...args);
  return Response.json({ date_filter: { from, to }, filters: { departmentId: departmentId || null }, people });
}


