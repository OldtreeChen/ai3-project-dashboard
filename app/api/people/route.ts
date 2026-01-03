import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { parseIdParam } from '../_utils';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const departmentId = parseIdParam(url.searchParams.get('departmentId'));

  const m = await getEcpMapping();
  const U = sqlId(m.tables.user);
  const uId = sqlId(m.user.id);
  const uAccount = m.user.account ? sqlId(m.user.account) : null;
  const uName = sqlId(m.user.displayName);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

  let sql = `
    SELECT
      u.${uId} AS id,
      ${uAccount ? `u.${uAccount} AS account,` : `NULL AS account,`}
      u.${uName} AS display_name
      ${uDeptId ? `,u.${uDeptId} AS department_id` : `,NULL AS department_id`}
    FROM ${U} u
    WHERE 1=1
  `;
  const args: Array<string> = [];
  if (departmentId && uDeptId) {
    sql += ` AND u.${uDeptId} = ?`;
    args.push(departmentId);
  }
  sql += ` ORDER BY u.${uName} ASC`;

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);
  return Response.json(rows);
}



