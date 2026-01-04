import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getProjectTypeTextsByValues } from '@/lib/projectTypeDictionary';
import { getProjectStatusTextsByValues } from '@/lib/projectStatusDictionary';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { getProjectTypeColumn } from '@/lib/projectType';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = await ctx.params;
  if (!ownerId) return Response.json({ error: 'invalid ownerId' }, { status: 400 });
  const url = new URL(req.url);
  const projectTypesParam = String(url.searchParams.get('projectTypes') || '').trim();
  const projectTypeValues = projectTypesParam
    ? Array.from(new Set(projectTypesParam.split(',').map((s) => s.trim()).filter(Boolean)))
    : [];

  const m = await getEcpMapping();
  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);
  const D = m.tables.department ? sqlId(m.tables.department) : null;

  const pId = sqlId(m.project.id);
  const pCode = m.project.code ? sqlId(m.project.code) : null;
  const pName = sqlId(m.project.name);
  const pPlanned = m.project.plannedHours ? sqlId(m.project.plannedHours) : null;
  const pStatus = m.project.status ? sqlId(m.project.status) : null;
  const pDeptId = m.project.departmentId ? sqlId(m.project.departmentId) : null;
  const ownerCol = await getProjectOwnerColumn();
  const pOwner = ownerCol ? sqlId(ownerCol) : null;
  const typeCol = await getProjectTypeColumn();
  const pType = typeCol ? sqlId(typeCol) : null;
  const dId = m.department?.id ? sqlId(m.department.id) : null;
  const dName = m.department?.name ? sqlId(m.department.name) : null;

  const tProjectId = sqlId(m.task.projectId);
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;

  if (!pOwner) return Response.json({ projects: [] });

  const plannedExpr = pPlanned ? `COALESCE(p.${pPlanned}, 0)` : '0';
  const usedExpr = tHours ? `COALESCE(SUM(t.${tHours}), 0)` : '0';
  const plannedAggExpr = pPlanned ? `MAX(COALESCE(p.${pPlanned}, 0))` : '0';
  const executingFilter = pStatus
    ? `AND p.${pStatus} IN ('New','Executing','ExecuteAuditing','ExecuteBack','Overdue','OverdueUpgrade')`
    : '';
  const projectDeptFilter =
    D && dId && dName && pDeptId
      ? `AND (d.${dName} LIKE '%AI專案一部%' OR d.${dName} LIKE '%AI專案二部%')`
      : '';

  const projectTypeFilter =
    pType && projectTypeValues.length ? `AND p.${pType} IN (${projectTypeValues.map(() => '?').join(',')})` : '';

  const sql = `
    SELECT
      p.${pId} AS id,
      ${pCode ? `p.${pCode} AS code,` : `NULL AS code,`}
      p.${pName} AS name,
      ${pStatus ? `p.${pStatus} AS status,` : `NULL AS status,`}
      ${pType ? `p.${pType} AS project_type_raw,` : `NULL AS project_type_raw,`}
      ${plannedAggExpr} AS planned_hours,
      ${usedExpr} AS used_hours,
      (${plannedAggExpr} - ${usedExpr}) AS remaining_hours
    FROM ${P} p
    LEFT JOIN ${T} t ON t.${tProjectId} = p.${pId}
    ${D && dId && dName && pDeptId ? `LEFT JOIN ${D} d ON d.${dId} = p.${pDeptId}` : ''}
    WHERE p.${pOwner} = ?
      AND p.${pName} NOT LIKE '%新人%'
      AND p.${pName} LIKE '【AI】%'
      ${executingFilter}
      ${projectDeptFilter}
      ${projectTypeFilter}
    GROUP BY p.${pId}
    ORDER BY remaining_hours DESC, planned_hours DESC, p.${pId} DESC
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ownerId, ...projectTypeValues);

  const typeValues = Array.from(new Set(rows.map((r) => String(r.project_type_raw ?? '').trim()).filter(Boolean)));
  const dict = await getProjectTypeTextsByValues(typeValues);
  for (const r of rows) {
    const raw = String(r.project_type_raw ?? '').trim();
    r.project_type = raw ? (dict.get(raw) || raw) : null;
  }

  const statusValues = Array.from(new Set(rows.map((r) => String(r.status ?? '').trim()).filter(Boolean)));
  const statusDict = await getProjectStatusTextsByValues(statusValues);
  for (const r of rows) {
    const raw = String(r.status ?? '').trim();
    r.status_zh = raw ? statusDict.get(raw) || null : null;
  }

  return Response.json({ ownerId, projects: rows });
}


