import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getDictionaryTextsByValues } from '@/lib/dictionary';
import { parseIdParam, parseIntParam } from '../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));
  const ownerId = parseIdParam(url.searchParams.get('ownerId'));
  const q = (url.searchParams.get('q') || '').trim();
  const limit = parseIntParam(url.searchParams.get('limit')) || 500;

  const m = await getEcpMapping();

  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);
  const U = sqlId(m.tables.user);

  const pId = sqlId(m.project.id);
  const pCode = m.project.code ? sqlId(m.project.code) : null;
  const pName = sqlId(m.project.name);
  const pPlanned = m.project.plannedHours ? sqlId(m.project.plannedHours) : null;
  const pStart = m.project.startDate ? sqlId(m.project.startDate) : null;
  const pEnd = m.project.endDate ? sqlId(m.project.endDate) : null;
  const pStatus = m.project.status ? sqlId(m.project.status) : null;
  const pDeptId = m.project.departmentId ? sqlId(m.project.departmentId) : null;
  const pOwner = m.project.ownerUserId ? sqlId(m.project.ownerUserId) : null;
  const pType = m.project.projectType ? sqlId(m.project.projectType) : null;

  const tProjectId = sqlId(m.task.projectId);
  const tActual = m.task.actualHours ? sqlId(m.task.actualHours) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  const args: Array<string> = [];
  let where = `WHERE 1=1`;

  // 排除新人專案
  where += ` AND p.${pName} NOT LIKE ?`;
  args.push('%新人%');

  // 排除成功關閉（依 dictionary 值，不用中文模糊）
  if (pStatus) {
    where += ` AND p.${pStatus} NOT IN ('Finished','FinishAuditing','Discarded','Cancel')`;
  }

  if (departmentId && pDeptId) {
    where += ` AND p.${pDeptId} = ?`;
    args.push(departmentId);
  }

  if (ownerId && pOwner) {
    where += ` AND p.${pOwner} = ?`;
    args.push(ownerId);
  }

  if (q) {
    if (pCode) {
      where += ` AND (p.${pName} LIKE ? OR p.${pCode} LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`);
    } else {
      where += ` AND (p.${pName} LIKE ?)`;
      args.push(`%${q}%`);
    }
  }

  const plannedExpr = pPlanned ? `COALESCE(p.${pPlanned}, 0)` : '0';
  const actualExpr = tActual ? `COALESCE(SUM(t.${tActual}), 0)` : '0';

  const sql = `
    SELECT
      p.${pId} AS id,
      ${pCode ? `p.${pCode} AS code,` : `NULL AS code,`}
      p.${pName} AS name,
      ${plannedExpr} AS planned_hours,
      ${pStart ? `p.${pStart} AS start_date,` : `NULL AS start_date,`}
      ${pEnd ? `p.${pEnd} AS end_date,` : `NULL AS end_date,`}
      ${pStatus ? `p.${pStatus} AS status,` : `NULL AS status,`}
      ${pDeptId ? `p.${pDeptId} AS department_id,` : `NULL AS department_id,`}
      ${pOwner ? `p.${pOwner} AS owner_user_id,` : `NULL AS owner_user_id,`}
      ${pOwner ? `owner.${uName} AS owner_name,` : `NULL AS owner_name,`}
      ${pType ? `p.${pType} AS project_type_raw,` : `NULL AS project_type_raw,`}
      ${actualExpr} AS actual_hours
    FROM ${P} p
    LEFT JOIN ${T} t ON t.${tProjectId} = p.${pId}
    ${pOwner ? `LEFT JOIN ${U} owner ON owner.${uId} = p.${pOwner}` : ''}
    ${where}
    GROUP BY p.${pId}
    ORDER BY p.${pId} DESC
    LIMIT ${Math.min(limit, 2000)}
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

  // project type zh (best-effort via dictionary table)
  const typeValues = Array.from(new Set(rows.map((r) => String(r.project_type_raw ?? '').trim()).filter(Boolean)));
  const dict = await getDictionaryTextsByValues(typeValues);
  for (const r of rows) {
    const raw = String(r.project_type_raw ?? '').trim();
    r.project_type = raw ? (dict.get(raw) || raw) : null;
  }

  return Response.json(rows);
}



