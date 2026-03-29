import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getUserActiveFilter } from '@/lib/userActive';
import { getAiDeptIds } from '@/lib/aiPeopleWhitelist';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const departmentId = url.searchParams.get('departmentId') || '';

    const m = await getEcpMapping();
    const U = sqlId(m.tables.user);
    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
    const uDeptName = m.user.departmentName ? sqlId(m.user.departmentName) : null;

    const { dept1Id, dept2Id } = await getAiDeptIds();
    const active = await getUserActiveFilter(m.tables.user, 'u');

    // If department table exists, join for name
    const D = m.tables.department && m.department ? sqlId(m.tables.department) : null;
    const dId = m.department ? sqlId(m.department.id) : null;
    const dName = m.department ? sqlId(m.department.name) : null;

    let sql = `
      SELECT
        u.${uId} AS user_id,
        u.${uName} AS display_name,
        ${uAccount ? `u.${uAccount} AS account,` : "NULL AS account,"}
        ${uDeptId ? `u.${uDeptId} AS department_id,` : "NULL AS department_id,"}
        ${D && dId && dName && uDeptId
          ? `d.${dName} AS department_name`
          : uDeptName ? `u.${uDeptName} AS department_name` : "NULL AS department_name"
        }
      FROM ${U} u
      ${D && dId && uDeptId ? `LEFT JOIN ${D} d ON d.${dId} = u.${uDeptId}` : ''}
      WHERE 1=1
        AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?
    `;
    const args: any[] = ['%MidECP-User%', '%service_user%'];

    sql += active.where;

    // Filter by department
    if (departmentId) {
      if (uDeptId) {
        sql += ` AND u.${uDeptId} = ?`;
        args.push(departmentId);
      }
    } else {
      // Default: show AI dept 1 & 2
      if (uDeptId && dept1Id && dept2Id) {
        sql += ` AND u.${uDeptId} IN (?, ?)`;
        args.push(dept1Id, dept2Id);
      }
    }

    sql += ` ORDER BY ${D && dName && uDeptId ? `d.${dName} ASC,` : ''} u.${uName} ASC`;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // De-dupe by normalized name
    const seen = new Set<string>();
    const members: any[] = [];
    for (const r of rows) {
      const name = String(r.display_name || '').trim();
      const nameKey = name.replace(/\s*[\(（][^)）]*[\)）]\s*$/, '').trim();
      if (!nameKey || seen.has(nameKey)) continue;
      seen.add(nameKey);
      members.push({
        user_id: String(r.user_id || ''),
        display_name: name,
        account: r.account ? String(r.account) : null,
        department_id: r.department_id ? String(r.department_id) : null,
        department_name: r.department_name ? String(r.department_name) : null,
      });
    }

    return Response.json({
      total: members.length,
      filters: { departmentId: departmentId || null },
      members,
    });
  } catch (err: any) {
    return Response.json({ error: err?.message || 'unknown error' }, { status: 500 });
  }
}
