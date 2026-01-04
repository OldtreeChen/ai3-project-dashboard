import { prisma } from '@/lib/prisma';
import { getEcpColumns, getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { getProjectTypeColumn } from '@/lib/projectType';
import { getProjectTypeTextsByValues } from '@/lib/projectTypeDictionary';
import { getProjectStatusTextsByValues } from '@/lib/projectStatusDictionary';
import { parseIdParam, parseIntParam } from '../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));
  const ownerId = parseIdParam(url.searchParams.get('ownerId'));
  const limit = parseIntParam(url.searchParams.get('limit')) || 500;

  const m = await getEcpMapping();
  const colsInfo = await getEcpColumns();
  const pCols = (colsInfo.columns as any)?.[m.tables.project] as Array<{ column_name: string }> | undefined;
  const pSet = new Set((pCols || []).map((c) => c.column_name));
  const pIf = (col?: string) => (col && pSet.has(col) ? sqlId(col) : null);

  const P = sqlId(m.tables.project);
  const U = sqlId(m.tables.user);

  const pId = sqlId(m.project.id);
  const pCode = pIf(m.project.code);
  const pName = sqlId(m.project.name);
  const pPlanned = pIf(m.project.plannedHours);
  const pStatus = pIf(m.project.status);
  const pDeptId = pIf(m.project.departmentId);

  const ownerCol = await getProjectOwnerColumn();
  const pOwner = ownerCol && pSet.has(ownerCol) ? sqlId(ownerCol) : null;

  const typeCol = await getProjectTypeColumn();
  const pType = typeCol && pSet.has(typeCol) ? sqlId(typeCol) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  const args: Array<string> = [];
  let where = `WHERE 1=1`;

  // 排除新人專案、只看【AI】開頭
  where += ` AND p.${pName} NOT LIKE ?`;
  args.push('%新人%');
  where += ` AND p.${pName} LIKE ?`;
  args.push('【AI】%');

  // 只列出「新增 / 已分配」
  if (pStatus) {
    where += ` AND p.${pStatus} IN ('New','Assigned')`;
  } else {
    // 沒有 status 欄位就沒辦法列（避免錯誤回傳空）
    return Response.json({ projects: [] });
  }

  if (departmentId && pDeptId) {
    where += ` AND p.${pDeptId} = ?`;
    args.push(departmentId);
  }

  if (ownerId && pOwner) {
    where += ` AND p.${pOwner} = ?`;
    args.push(ownerId);
  }

  const plannedExpr = pPlanned ? `COALESCE(p.${pPlanned}, 0)` : '0';

  const sql = `
    SELECT
      p.${pId} AS id,
      ${pCode ? `p.${pCode} AS code,` : `NULL AS code,`}
      p.${pName} AS name,
      ${plannedExpr} AS planned_hours,
      p.${pStatus} AS status,
      ${pDeptId ? `p.${pDeptId} AS department_id,` : `NULL AS department_id,`}
      ${pOwner ? `p.${pOwner} AS owner_user_id,` : `NULL AS owner_user_id,`}
      ${pOwner ? `owner.${uName} AS owner_name,` : `NULL AS owner_name,`}
      ${pType ? `p.${pType} AS project_type_raw` : `NULL AS project_type_raw`}
    FROM ${P} p
    ${pOwner ? `LEFT JOIN ${U} owner ON owner.${uId} = p.${pOwner}` : ''}
    ${where}
    ORDER BY p.${pId} DESC
    LIMIT ${Math.min(limit, 2000)}
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

  // enrich: type zh
  const typeValues = Array.from(new Set(rows.map((r) => String(r.project_type_raw ?? '').trim()).filter(Boolean)));
  const typeDict = await getProjectTypeTextsByValues(typeValues);
  for (const r of rows) {
    const raw = String(r.project_type_raw ?? '').trim();
    r.project_type = raw ? typeDict.get(raw) || raw : null;
  }

  // enrich: status zh
  const statusValues = Array.from(new Set(rows.map((r) => String(r.status ?? '').trim()).filter(Boolean)));
  const statusDict = await getProjectStatusTextsByValues(statusValues);
  for (const r of rows) {
    const raw = String(r.status ?? '').trim();
    r.status_zh = raw ? statusDict.get(raw) || null : null;
  }

  return Response.json({ projects: rows });
}


