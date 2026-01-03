import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getDictionaryTextsByValues } from '@/lib/dictionary';

export const dynamic = 'force-dynamic';

export async function GET() {
  const m = await getEcpMapping();
  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);
  const U = sqlId(m.tables.user);

  const pId = sqlId(m.project.id);
  const pName = sqlId(m.project.name);
  const pPlanned = m.project.plannedHours ? sqlId(m.project.plannedHours) : null;
  const pStatus = m.project.status ? sqlId(m.project.status) : null;
  const pOwner = m.project.ownerUserId ? sqlId(m.project.ownerUserId) : null;
  const pType = m.project.projectType ? sqlId(m.project.projectType) : null;

  const tProjectId = sqlId(m.task.projectId);
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  if (!pOwner) return Response.json({ owners: [] });

  const plannedExpr = pPlanned ? `COALESCE(p.${pPlanned}, 0)` : '0';
  const usedExpr = tHours ? `COALESCE(SUM(t.${tHours}), 0)` : '0';

  const sql = `
    SELECT
      p.${pOwner} AS owner_id,
      u.${uName} AS owner_name,
      COUNT(DISTINCT p.${pId}) AS project_count,
      COALESCE(SUM(${plannedExpr}), 0) AS planned_hours,
      ${usedExpr} AS used_hours,
      (COALESCE(SUM(${plannedExpr}), 0) - ${usedExpr}) AS remaining_hours
    FROM ${P} p
    LEFT JOIN ${U} u ON u.${uId} = p.${pOwner}
    LEFT JOIN ${T} t ON t.${tProjectId} = p.${pId}
    WHERE p.${pName} NOT LIKE '%新人%'
      ${pStatus ? `AND p.${pStatus} NOT IN ('Finished','FinishAuditing','Discarded','Cancel')` : ''}
    GROUP BY p.${pOwner}
    ORDER BY remaining_hours DESC, planned_hours DESC, owner_name ASC
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql);

  // 900 hours per month capacity
  const owners = rows.map((r) => {
    const remaining = Number(r.remaining_hours || 0);
    return {
      ...r,
      remaining_load_months: remaining / 900
    };
  });

  // also return a quick type mapping hint (best-effort)
  const typeValues = pType ? Array.from(new Set((await prisma.$queryRawUnsafe<any[]>(`SELECT DISTINCT p.${pType} AS v FROM ${P} p WHERE p.${pType} IS NOT NULL AND p.${pType} <> '' LIMIT 200`)).map((x) => String(x.v ?? '').trim()).filter(Boolean))) : [];
  const dict = await getDictionaryTextsByValues(typeValues);

  return Response.json({ owners, project_type_map: Object.fromEntries(dict.entries()) });
}


