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
  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);
  const TD = sqlId(m.tables.time);
  const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;
  const U = sqlId(m.tables.user);

  const pId = sqlId(m.project.id);
  const pCode = m.project.code ? sqlId(m.project.code) : null;
  const pName = sqlId(m.project.name);
  const pPlanned = m.project.plannedHours ? sqlId(m.project.plannedHours) : null;
  const pStart = m.project.startDate ? sqlId(m.project.startDate) : null;
  const pEnd = m.project.endDate ? sqlId(m.project.endDate) : null;
  const pStatus = m.project.status ? sqlId(m.project.status) : null;

  const tId = sqlId(m.task.id);
  const tProjectId = sqlId(m.task.projectId);
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;

  const tdTaskId = sqlId(m.time.taskId);
  const tdUserId = sqlId(m.time.userId);
  const tdHours = sqlId(m.time.hours);
  const tdTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;

  const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
  const thDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

  const uId = sqlId(m.user.id);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  // project row
  const projectSql = `
    SELECT
      p.${pId} AS id,
      ${pCode ? `p.${pCode} AS code,` : `NULL AS code,`}
      p.${pName} AS name,
      ${pPlanned ? `p.${pPlanned} AS planned_hours,` : `0 AS planned_hours,`}
      ${pStart ? `p.${pStart} AS start_date,` : `NULL AS start_date,`}
      ${pEnd ? `p.${pEnd} AS end_date,` : `NULL AS end_date,`}
      ${pStatus ? `p.${pStatus} AS status` : `NULL AS status`}
    FROM ${P} p
    WHERE p.${pId} = ?
    LIMIT 1
  `;
  const project = (await prisma.$queryRawUnsafe<any[]>(projectSql, projectId))[0];
  if (!project) return Response.json({ error: 'project not found' }, { status: 404 });

  const taskCountSql = `SELECT COUNT(1) AS task_count FROM ${T} t WHERE t.${tProjectId} = ?`;
  const taskCount = (await prisma.$queryRawUnsafe<any[]>(taskCountSql, projectId))[0]?.task_count ?? 0;

  // 1) 專案已填報時數：任務本身 actualHours 加總（不受日期篩選影響）
  const projectActualSql = tHours
    ? `
      SELECT COALESCE(SUM(t.${tHours}), 0) AS actual_hours
      FROM ${T} t
      WHERE t.${tProjectId} = ?
    `
    : `
      SELECT 0 AS actual_hours
    `;
  const projectActual = (await prisma.$queryRawUnsafe<Array<{ actual_hours: number }>>(projectActualSql, projectId))?.[0]?.actual_hours ?? 0;

  // 2) 人數：仍用工時填報（可選日期/人員/部門）
  let peopleSql = `
    SELECT COUNT(DISTINCT te.person_id) AS people_count
    FROM ${TD} te
    JOIN ${T} t ON t.${tId} = te.${tdTaskId}
    JOIN ${U} pe ON pe.${uId} = te.${tdUserId}
    WHERE t.${tProjectId} = ?
  `;
  const args: Array<string> = [projectId];
  if (from && to && TH && thId && thDate && tdTimeReportId) {
    peopleSql += ` AND EXISTS (
      SELECT 1 FROM ${TH} th
      WHERE th.${thId} = te.${tdTimeReportId}
        AND th.${thDate} BETWEEN ? AND ?
    )`;
    args.push(from, to);
  }
  if (personId) {
    peopleSql += ` AND te.${tdUserId} = ?`;
    args.push(personId);
  }
  if (departmentId && uDeptId) {
    peopleSql += ` AND pe.${uDeptId} = ?`;
    args.push(departmentId);
  }

  const people = await prisma.$queryRawUnsafe<Array<{ people_count: number }>>(peopleSql, ...args);
  const peopleCount = people?.[0]?.people_count ?? 0;

  return Response.json({
    ...project,
    date_filter: from && to ? { from, to } : null,
    filters: { personId: personId || null, departmentId: departmentId || null },
    task_count: taskCount,
    actual_hours: projectActual,
    people_count: peopleCount
  });
}


