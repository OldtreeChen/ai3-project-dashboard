import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { parseIdParam } from '../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));

  const m = await getEcpMapping();
  const P = sqlId(m.tables.project);
  const U = sqlId(m.tables.user);

  const pName = sqlId(m.project.name);
  const ownerCol = await getProjectOwnerColumn();
  const pOwner = ownerCol ? sqlId(ownerCol) : null;
  const pDeptId = m.project.departmentId ? sqlId(m.project.departmentId) : null;
  const pStatus = m.project.status ? sqlId(m.project.status) : null;

  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  if (!pOwner) return Response.json([]);

  const args: string[] = [];
  let where = `WHERE 1=1`;

  // 排除新人專案
  where += ` AND p.${pName} NOT LIKE ?`;
  args.push('%新人%');

  // 排除成功關閉
  if (pStatus) where += ` AND p.${pStatus} NOT IN ('Finished','FinishAuditing','Discarded','Cancel')`;

  if (departmentId && pDeptId) {
    where += ` AND p.${pDeptId} = ?`;
    args.push(departmentId);
  }

  const sql = `
    SELECT DISTINCT
      p.${pOwner} AS id,
      u.${uName} AS display_name
    FROM ${P} p
    LEFT JOIN ${U} u ON u.${uId} = p.${pOwner}
    ${where}
    ORDER BY display_name ASC
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);
  // 去除重複/空值
  const seen = new Set<string>();
  const out = [];
  for (const r of rows) {
    const id = String(r.id ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return Response.json(out);
}


