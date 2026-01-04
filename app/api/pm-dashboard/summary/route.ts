import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getProjectTypeTextsByValues } from '@/lib/projectTypeDictionary';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { getProjectTypeColumn } from '@/lib/projectType';
import { parseIdParam } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const departmentId = parseIdParam(url.searchParams.get('departmentId'));
    const ownerId = parseIdParam(url.searchParams.get('ownerId'));
    const projectTypesParam = String(url.searchParams.get('projectTypes') || '').trim();
    const projectTypeValues = projectTypesParam
      ? Array.from(new Set(projectTypesParam.split(',').map((s) => s.trim()).filter(Boolean)))
      : [];

    const m = await getEcpMapping();
    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const U = sqlId(m.tables.user);
    const D = m.tables.department ? sqlId(m.tables.department) : null;

    const pId = sqlId(m.project.id);
    const pName = sqlId(m.project.name);
    const pPlanned = m.project.plannedHours ? sqlId(m.project.plannedHours) : null;
    const pStatus = m.project.status ? sqlId(m.project.status) : null;
    const pDeptId = m.project.departmentId ? sqlId(m.project.departmentId) : null;
    const ownerCol = await getProjectOwnerColumn();
    const pOwner = ownerCol ? sqlId(ownerCol) : null;
    const typeCol = await getProjectTypeColumn();
    const pType = typeCol ? sqlId(typeCol) : null;

    const tProjectId = sqlId(m.task.projectId);
    const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
    const dId = m.department?.id ? sqlId(m.department.id) : null;
    const dName = m.department?.name ? sqlId(m.department.name) : null;

    if (!pOwner) return Response.json({ owners: [] });

    const plannedExpr = pPlanned ? `COALESCE(p.${pPlanned}, 0)` : '0';
    const usedExpr = tHours ? `COALESCE(SUM(t.${tHours}), 0)` : '0';

    // PM 負載：計算「已分配/新增」+「執行中/逾期」專案（排除 成功關閉 等）
    // 注意：若直接 join task 會把 p.planHours 依 task 筆數重複加總，必須先 per-project 彙總再 per-owner 彙總。
    const executingFilter = pStatus
      ? `AND p.${pStatus} IN ('Assigned','New','Executing','ExecuteAuditing','ExecuteBack','Overdue','OverdueUpgrade')`
      : '';

    const projectDeptFilter =
      D && dId && dName && pDeptId
        ? `AND (dp.${dName} LIKE '%AI專案一部%' OR dp.${dName} LIKE '%AI專案二部%')`
        : '';

    const subArgs: Array<string> = [];
    const args: Array<string> = [];
    let outerWhere = 'WHERE 1=1';

    const projectTypeFilter =
      pType && projectTypeValues.length ? `AND p.${pType} IN (${projectTypeValues.map(() => '?').join(',')})` : '';
    if (pType && projectTypeValues.length) subArgs.push(...projectTypeValues);

    const sql = `
      SELECT
        x.owner_id AS owner_id,
        u.${uName} AS owner_name,
        COUNT(1) AS project_count,
        COALESCE(SUM(x.planned_hours), 0) AS planned_hours,
        COALESCE(SUM(x.used_hours), 0) AS used_hours,
        COALESCE(SUM(x.planned_hours - x.used_hours), 0) AS remaining_hours
      FROM (
        SELECT
          p.${pId} AS project_id,
          p.${pOwner} AS owner_id,
          ${plannedExpr} AS planned_hours,
          ${usedExpr} AS used_hours
        FROM ${P} p
        LEFT JOIN ${T} t ON t.${tProjectId} = p.${pId}
        ${D && dId && dName && pDeptId ? `LEFT JOIN ${D} dp ON dp.${dId} = p.${pDeptId}` : ''}
        WHERE p.${pName} NOT LIKE '%新人%'
          AND (p.${pName} LIKE '【AI】%' OR p.${pName} LIKE 'AI】%')
          ${executingFilter}
          ${projectDeptFilter}
          ${projectTypeFilter}
        GROUP BY p.${pId}, p.${pOwner}
      ) x
      LEFT JOIN ${U} u ON u.${uId} = x.owner_id
      ${D && dId && dName && uDeptId ? `LEFT JOIN ${D} d ON d.${dId} = u.${uDeptId}` : ''}
      ${(() => {
        // owners must be from AI專案一部/二部 (by owner department name)
        if (D && dId && dName && uDeptId) {
          outerWhere += ` AND (d.${dName} LIKE ? OR d.${dName} LIKE ?)`;
          args.push('%AI專案一部%', '%AI專案二部%');
        }
        if (departmentId && uDeptId) {
          outerWhere += ` AND u.${uDeptId} = ?`;
          args.push(departmentId);
        }
        if (ownerId) {
          outerWhere += ` AND x.owner_id = ?`;
          args.push(ownerId);
        }
        return outerWhere;
      })()}
      GROUP BY x.owner_id
      ORDER BY remaining_hours DESC, planned_hours DESC, owner_name ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...subArgs, ...args);

    // normalize BigInt/Decimal-ish values for JSON safety
    const owners = rows.map((r) => {
      const planned = Number(r.planned_hours || 0);
      const used = Number(r.used_hours || 0);
      const remaining = Number(r.remaining_hours || 0);
      return {
        owner_id: r.owner_id,
        owner_name: r.owner_name,
        project_count: Number(r.project_count || 0),
        planned_hours: planned,
        used_hours: used,
        remaining_hours: remaining,
        remaining_load_months: remaining / 900
      };
    });

    // also return a quick type mapping hint (best-effort)
    const typeValues = pType
      ? Array.from(
          new Set(
            (await prisma.$queryRawUnsafe<any[]>(
              `
                SELECT DISTINCT p.${pType} AS v
                FROM ${P} p
                ${D && dId && dName && pDeptId ? `LEFT JOIN ${D} dp ON dp.${dId} = p.${pDeptId}` : ''}
                WHERE p.${pType} IS NOT NULL AND p.${pType} <> ''
                  AND p.${pName} NOT LIKE '%新人%'
                  AND (p.${pName} LIKE '【AI】%' OR p.${pName} LIKE 'AI】%')
                  ${executingFilter}
                  ${projectDeptFilter}
                LIMIT 200
              `
            ))
              .map((x) => String(x.v ?? '').trim())
              .filter(Boolean)
          )
        )
      : [];
    const dict = await getProjectTypeTextsByValues(typeValues);

    return Response.json({ owners, project_type_map: Object.fromEntries(dict.entries()) });
  } catch (err: any) {
    const message = err?.message ? String(err.message) : 'unknown error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}


