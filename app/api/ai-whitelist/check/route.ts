import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { AI_DEPT_WHITELISTS } from '@/lib/aiPeopleWhitelist';
import { getUserActiveFilter } from '@/lib/userActive';

export const dynamic = 'force-dynamic';

function normNameSql(uNameSql: string) {
  // strip anything after "(" or "（"
  return `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(${uNameSql}, '（', 1), '(', 1))`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeDisabled = url.searchParams.get('includeDisabled') === '1';

  const m = await getEcpMapping();
  const U = sqlId(m.tables.user);
  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);

  const baseNameExpr = normNameSql(`u.${uName}`);

  const commonArgs: any[] = [];
  let commonWhere = `WHERE 1=1`;

  // exclude system/service users
  commonWhere += ` AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?`;
  commonArgs.push('%MidECP-User%', '%service_user%');

  if (!includeDisabled) {
    const active = await getUserActiveFilter(m.tables.user, 'u');
    commonWhere += active.where;
  }

  const checkOne = async (names: string[]) => {
    if (!names.length) return { found: [] as string[], missing: [] as string[] };
    const ps = names.map(() => '?').join(',');
    const sql = `
      SELECT DISTINCT
        ${baseNameExpr} AS name,
        u.${uId} AS id
      FROM ${U} u
      ${commonWhere}
        AND ${baseNameExpr} IN (${ps})
      ORDER BY name ASC
    `;
    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...commonArgs, ...names);
    const found = Array.from(new Set(rows.map((r) => String(r.name ?? '').trim()).filter(Boolean)));
    const foundSet = new Set(found);
    const missing = names.filter((n) => !foundSet.has(n));
    return { found, missing };
  };

  const dept1 = await checkOne(AI_DEPT_WHITELISTS.dept1.names);
  const dept2 = await checkOne(AI_DEPT_WHITELISTS.dept2.names);

  return Response.json({
    includeDisabled,
    user_table: m.tables.user,
    display_name_column: m.user.displayName,
    results: {
      dept1: { deptName: AI_DEPT_WHITELISTS.dept1.deptName, ...dept1 },
      dept2: { deptName: AI_DEPT_WHITELISTS.dept2.deptName, ...dept2 }
    }
  });
}


