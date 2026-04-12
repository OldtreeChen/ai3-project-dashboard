import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { getUserActiveFilter } from '@/lib/userActive';
import { parseIdParam } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = `'Assigned','New','Executing','ExecuteAuditing','ExecuteBack','Overdue','OverdueUpgrade','AutoUpgrade'`;

async function findMilestoneTable(): Promise<string | null> {
  try {
    const rows = await (prisma.$queryRawUnsafe as any)(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN ('TcProjectMilestone','TcMilestone','TsMilestone')
       LIMIT 1`
    ) as Array<{ table_name: string }>;
    return rows[0]?.table_name || null;
  } catch { return null; }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const departmentId = parseIdParam(url.searchParams.get('departmentId'));

    const m = await getEcpMapping();
    const P = sqlId(m.tables.project);
    const U = sqlId(m.tables.user);
    const D = m.tables.department ? sqlId(m.tables.department) : null;

    const pId = sqlId(m.project.id);
    const pName = sqlId(m.project.name);
    const pStatus = m.project.status ? sqlId(m.project.status) : null;
    const pDeptId = m.project.departmentId ? sqlId(m.project.departmentId) : null;
    const ownerCol = await getProjectOwnerColumn();
    const pOwner = ownerCol ? sqlId(ownerCol) : null;

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
    const dId = m.department?.id ? sqlId(m.department.id) : null;
    const dName = m.department?.name ? sqlId(m.department.name) : null;

    if (!pStatus) return Response.json({ overdueProjects: [], upcomingProjects: [], overdueMilestones: [], upcomingMilestones: [] });

    const projectDeptJoin = D && dId && dName && pDeptId
      ? `LEFT JOIN ${D} dp ON dp.${dId} = p.${pDeptId}` : '';
    const projectDeptFilter = D && dId && dName && pDeptId
      ? `AND (dp.${dName} LIKE '%AI專案一部%' OR dp.${dName} LIKE '%AI專案二部%')` : '';
    const ownerJoin = pOwner
      ? `LEFT JOIN ${U} u ON u.${uId} = p.${pOwner}` : '';
    const ownerDeptJoin = D && dId && dName && uDeptId
      ? `LEFT JOIN ${D} od ON od.${dId} = u.${uDeptId}` : '';

    const activeFilter = await getUserActiveFilter(m.tables.user, 'u');
    const deptFilter = departmentId && pDeptId ? `AND p.${pDeptId} = ?` : '';
    const deptArgs: string[] = departmentId && pDeptId ? [departmentId] : [];

    const baseNameFilter = `
      p.${pName} NOT LIKE '%新人%'
      AND (p.${pName} LIKE '【AI】%' OR p.${pName} LIKE 'AI】%')
      ${projectDeptFilter}
      ${deptFilter}
    `;

    const projectSelectCols = `
      p.${pId} AS id,
      p.${pName} AS name,
      ${pStatus ? `p.${pStatus} AS status,` : 'NULL AS status,'}
      p.FPlanEndDate AS plan_end_date,
      ${pOwner ? `u.${uName} AS owner_name,` : 'NULL AS owner_name,'}
      ${D && dId && dName && pDeptId ? `dp.${dName} AS dept_name` : 'NULL AS dept_name'}
    `;

    // 1) Overdue projects
    const overdueProjectsSql = `
      SELECT ${projectSelectCols}
      FROM ${P} p
      ${projectDeptJoin}
      ${ownerJoin}
      ${ownerDeptJoin}
      WHERE ${baseNameFilter}
        AND p.FPlanEndDate < CURDATE()
        AND p.${pStatus} IN (${ACTIVE_STATUSES})
        ${activeFilter.where}
      ORDER BY p.FPlanEndDate ASC
      LIMIT 200
    `;

    // 2) Upcoming projects (next 7 days)
    const upcomingProjectsSql = `
      SELECT ${projectSelectCols}
      FROM ${P} p
      ${projectDeptJoin}
      ${ownerJoin}
      ${ownerDeptJoin}
      WHERE ${baseNameFilter}
        AND p.FPlanEndDate BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND p.${pStatus} IN (${ACTIVE_STATUSES})
        ${activeFilter.where}
      ORDER BY p.FPlanEndDate ASC
      LIMIT 200
    `;

    const milestoneTable = await findMilestoneTable();
    const M = milestoneTable ? sqlId(milestoneTable) : null;

    let overdueMilestones: any[] = [];
    let upcomingMilestones: any[] = [];

    if (M) {
      const milestoneSelectCols = `
        ms.FId AS id,
        ms.FName AS milestone_name,
        p.${pId} AS project_id,
        p.${pName} AS project_name,
        ms.FFinishDate AS plan_date,
        ms.FStatus AS status,
        ${pOwner ? `u.${uName} AS owner_name,` : 'NULL AS owner_name,'}
        ${D && dId && dName && pDeptId ? `dp.${dName} AS dept_name` : 'NULL AS dept_name'}
      `;

      const milestoneJoins = `
        JOIN ${P} p ON p.${pId} = ms.FProjectId
        ${projectDeptJoin}
        ${ownerJoin}
        ${ownerDeptJoin}
      `;

      const milestoneBaseFilter = `
        ${baseNameFilter}
        AND p.${pStatus} IN (${ACTIVE_STATUSES})
        AND (ms.FStatus IS NULL OR ms.FStatus NOT IN ('Finished','Cancel','Discarded'))
        ${activeFilter.where}
      `;

      const overdueMilestonesSql = `
        SELECT ${milestoneSelectCols}
        FROM ${M} ms
        ${milestoneJoins}
        WHERE ${milestoneBaseFilter}
          AND ms.FFinishDate < CURDATE()
        ORDER BY ms.FFinishDate ASC
        LIMIT 200
      `;

      const upcomingMilestonesSql = `
        SELECT ${milestoneSelectCols}
        FROM ${M} ms
        ${milestoneJoins}
        WHERE ${milestoneBaseFilter}
          AND ms.FFinishDate BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        ORDER BY ms.FFinishDate ASC
        LIMIT 200
      `;

      [overdueMilestones, upcomingMilestones] = await Promise.all([
        (prisma.$queryRawUnsafe as any)(overdueMilestonesSql, ...deptArgs) as Promise<any[]>,
        (prisma.$queryRawUnsafe as any)(upcomingMilestonesSql, ...deptArgs) as Promise<any[]>,
      ]);
    }

    const [overdueProjectsRaw, upcomingProjectsRaw] = await Promise.all([
      (prisma.$queryRawUnsafe as any)(overdueProjectsSql, ...deptArgs) as Promise<any[]>,
      (prisma.$queryRawUnsafe as any)(upcomingProjectsSql, ...deptArgs) as Promise<any[]>,
    ]);

    const mapProject = (r: any) => ({
      id: String(r.id),
      name: String(r.name || ''),
      status: r.status ? String(r.status) : null,
      plan_end_date: r.plan_end_date ? String(r.plan_end_date).slice(0, 10) : null,
      owner_name: r.owner_name ? String(r.owner_name) : null,
      dept_name: r.dept_name ? String(r.dept_name) : null,
    });

    const mapMilestone = (r: any) => ({
      id: String(r.id),
      milestone_name: String(r.milestone_name || ''),
      project_id: String(r.project_id),
      project_name: String(r.project_name || ''),
      plan_date: r.plan_date ? String(r.plan_date).slice(0, 10) : null,
      status: r.status ? String(r.status) : null,
      owner_name: r.owner_name ? String(r.owner_name) : null,
      dept_name: r.dept_name ? String(r.dept_name) : null,
    });

    return Response.json({
      overdueProjects: overdueProjectsRaw.map(mapProject),
      upcomingProjects: upcomingProjectsRaw.map(mapProject),
      overdueMilestones: overdueMilestones.map(mapMilestone),
      upcomingMilestones: upcomingMilestones.map(mapMilestone),
    });
  } catch (err: any) {
    const message = err?.message ? String(err.message) : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
