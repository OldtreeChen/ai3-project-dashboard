import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const m = await getEcpMapping();
  const U = sqlId(m.tables.user);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
  const uDeptName = m.user.departmentName ? sqlId(m.user.departmentName) : null;

  if (!uDeptId && !uDeptName) return Response.json([]);

  // 若只有 deptName，則以 name 當 id
  const idExpr = uDeptId ? `u.${uDeptId}` : `u.${uDeptName}`;
  const nameExpr = uDeptName ? `u.${uDeptName}` : `u.${uDeptId}`;

  const sql = `
    SELECT DISTINCT
      ${idExpr} AS id,
      ${nameExpr} AS name
    FROM ${U} u
    WHERE ${idExpr} IS NOT NULL AND ${idExpr} <> ''
    ORDER BY name ASC
  `;
  const rows = await prisma.$queryRawUnsafe<any[]>(sql);
  return Response.json(rows);
}



