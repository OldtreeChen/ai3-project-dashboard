import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getDictionaryTextsByValues } from '@/lib/dictionary';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { getProjectTypeColumn } from '@/lib/projectType';
import { parseIdParam, parseIntParam } from '../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));
  const ownerId = parseIdParam(url.searchParams.get('ownerId'));
  const q = (url.searchParams.get('q') || '').trim();
  const limit = parseIntParam(url.searchParams.get('limit')) || 500;

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const pCols = (colsInfo.columns as any)?.[m.tables.project] as Array<{ column_name: string }> | undefined;
  const tCols = (colsInfo.columns as any)?.[m.tables.task] as Array<{ column_name: string }> | undefined;
  const pSet = new Set((pCols || []).map((c) => c.column_name));
  const tSet = new Set((tCols || []).map((c) => c.column_name));
  const pIf = (col?: string) => (col && pSet.has(col) ? sqlId(col) : null);
  const tIf = (col?: string) => (col && tSet.has(col) ? sqlId(col) : null);

  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);
  const U = sqlId(m.tables.user);

  const pId = sqlId(m.project.id);
  const pCode = pIf(m.project.code);
  const pName = sqlId(m.project.name);
  const pPlanned = pIf(m.project.plannedHours);
  const pStart = pIf(m.project.startDate);
  const pEnd = pIf(m.project.endDate);
  const pStatus = pIf(m.project.status);
  const pDeptId = pIf(m.project.departmentId);
  const ownerCol = await getProjectOwnerColumn();
  const pOwner = ownerCol && pSet.has(ownerCol) ? sqlId(ownerCol) : null;
  const typeCol = await getProjectTypeColumn();
  const pType = typeCol && pSet.has(typeCol) ? sqlId(typeCol) : null;

  const tProjectId = sqlId(m.task.projectId);
  const tActual = tIf(m.task.actualHours);

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  const args: Array<string> = [];
  let where = `WHERE 1=1`;

  // 排除新人專案
  where += ` AND p.${pName} NOT LIKE ?`;
  args.push('%新人%');

  // 顯示【AI】開頭的專案
  where += ` AND p.${pName} LIKE ?`;
  args.push('【AI】%');

  // 排除成功關閉（依 dictionary 值，不用中文模糊）
  if (pStatus) {
    where += ` AND p.${pStatus} NOT IN ('New', 'Finished','FinishAuditing','Discarded','Cancel')`;
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



