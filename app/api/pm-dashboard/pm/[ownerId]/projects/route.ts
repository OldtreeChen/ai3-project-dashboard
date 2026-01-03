import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getDictionaryTextsByValues } from '@/lib/dictionary';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = await ctx.params;
  if (!ownerId) return Response.json({ error: 'invalid ownerId' }, { status: 400 });

  const m = await getEcpMapping();
  const P = sqlId(m.tables.project);
  const T = sqlId(m.tables.task);

  const pId = sqlId(m.project.id);
  const pCode = m.project.code ? sqlId(m.project.code) : null;
  const pName = sqlId(m.project.name);
  const pPlanned = m.project.plannedHours ? sqlId(m.project.plannedHours) : null;
  const pStatus = m.project.status ? sqlId(m.project.status) : null;
  const pOwner = m.project.ownerUserId ? sqlId(m.project.ownerUserId) : null;
  const pType = m.project.projectType ? sqlId(m.project.projectType) : null;

  const tProjectId = sqlId(m.task.projectId);
  const tHours = m.task.actualHours ? sqlId(m.task.actualHours) : null;

  if (!pOwner) return Response.json({ projects: [] });

  const plannedExpr = pPlanned ? `COALESCE(p.${pPlanned}, 0)` : '0';
  const usedExpr = tHours ? `COALESCE(SUM(t.${tHours}), 0)` : '0';

  const sql = `
    SELECT
      p.${pId} AS id,
      ${pCode ? `p.${pCode} AS code,` : `NULL AS code,`}
      p.${pName} AS name,
      ${pStatus ? `p.${pStatus} AS status,` : `NULL AS status,`}
      ${pType ? `p.${pType} AS project_type_raw,` : `NULL AS project_type_raw,`}
      ${plannedExpr} AS planned_hours,
      ${usedExpr} AS used_hours,
      (${plannedExpr} - ${usedExpr}) AS remaining_hours
    FROM ${P} p
    LEFT JOIN ${T} t ON t.${tProjectId} = p.${pId}
    WHERE p.${pOwner} = ?
      AND p.${pName} NOT LIKE '%新人%'
      ${pStatus ? `AND p.${pStatus} NOT IN ('Finished','FinishAuditing','Discarded','Cancel')` : ''}
    GROUP BY p.${pId}
    ORDER BY remaining_hours DESC, planned_hours DESC, p.${pId} DESC
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ownerId);

  const typeValues = Array.from(new Set(rows.map((r) => String(r.project_type_raw ?? '').trim()).filter(Boolean)));
  const dict = await getDictionaryTextsByValues(typeValues);
  for (const r of rows) {
    const raw = String(r.project_type_raw ?? '').trim();
    r.project_type = raw ? (dict.get(raw) || raw) : null;
  }

  return Response.json({ ownerId, projects: rows });
}


