import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getAiDeptIds, EXCLUDED_USERS } from '@/lib/aiPeopleWhitelist';
import { getUserActiveFilter } from '@/lib/userActive';

export const dynamic = 'force-dynamic';

function normNameSql(uNameSql: string) {
  return `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(${uNameSql}, '（', 1), '(', 1))`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeDisabled = url.searchParams.get('includeDisabled') === '1';

  const m = await getEcpMapping();
  const U = sqlId(m.tables.user);
  const uId = sqlId(m.user.id);
  const uName = sqlId(m.user.displayName);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
  const uAccount = m.user.account ? sqlId(m.user.account) : null;

  const D = m.tables.department && m.department ? sqlId(m.tables.department) : null;
  const dId = m.department ? sqlId(m.department.id) : null;
  const dName = m.department ? sqlId(m.department.name) : null;

  const baseNameExpr = normNameSql(`u.${uName}`);

  const { dept1Id, dept2Id } = await getAiDeptIds();

  const loadDept = async (deptId: string | null, deptLabel: string, deptKey: 'dept1' | 'dept2') => {
    if (!deptId || !uDeptId) return { deptName: deptLabel, members: [], excluded: EXCLUDED_USERS };

    let sql = `
      SELECT DISTINCT
        ${baseNameExpr} AS name,
        u.${uId} AS id
        ${uAccount ? `, u.${uAccount} AS account` : ''}
        ${D && dId && dName ? `, d.${dName} AS dept_name` : ''}
      FROM ${U} u
      ${D && dId ? `LEFT JOIN ${D} d ON d.${dId} = u.${uDeptId}` : ''}
      WHERE 1=1
        AND u.${uDeptId} = ?
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;
    const args: any[] = [deptId, '%MidECP-User%', '%service_user%'];

    if (!includeDisabled) {
      const active = await getUserActiveFilter(m.tables.user, 'u');
      sql += active.where;
    }

    sql += ` ORDER BY name ASC`;

    const rows = await (prisma.$queryRawUnsafe as any)(sql, ...args) as any[];
    const members = rows.map((r) => ({
      name: String(r.name ?? '').trim(),
      id: String(r.id ?? ''),
      account: r.account ? String(r.account) : null,
      excluded: EXCLUDED_USERS.some((ex) => {
        const nameMatch = String(r.name ?? '').includes(ex.name);
        if (!nameMatch) return false;
        if (!ex.dept) return true;
        return ex.dept === deptKey;
      }),
    }));

    return { deptName: deptLabel, members, excluded: EXCLUDED_USERS };
  };

  const dept1 = await loadDept(dept1Id, 'AI專案一部', 'dept1');
  const dept2 = await loadDept(dept2Id, 'AI專案二部', 'dept2');

  return Response.json({
    includeDisabled,
    mode: 'database-driven',
    excluded_users: EXCLUDED_USERS,
    results: { dept1, dept2 }
  });
}
