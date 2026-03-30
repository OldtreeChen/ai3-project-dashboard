import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export type DeptWhitelist = { deptName: string; emails: string[]; names: string[] };

// Excluded users (not shown in any dashboard)
// These users have FEnabled=1 in DB but are actually inactive
export const EXCLUDED_USERS: string[] = [
  '陳慕霖',
  '陳治瑋',
  '沈子欽',
  '丁奕荳',
  '吳宗憲',
  '吳柚彤',
  '呂思潁',
  '周禹丞',
  '廖偉彤',
  '周儀',
  '張銘介',
  '張達明',
  '徐珮芳',
  '李若菲',
  '游志鴻',
  '范綱恒',
  '葉后儀',
  '蔡佳晏',
  '許光軒',
  '許如蕙',
  '邱欣怡',
  '何子杰',
  '吳佳勳',
  '廖冠富',
  '江昱儒',
  '江浩志',
  '胡妤安',
  '范光典',
  '葉德懋',
  '董妙珍',
  '鄭淑娟',
  '陳建翔',
];

const globalCache = globalThis as unknown as {
  __aiDeptIds?: { dept1Id: string | null; dept2Id: string | null };
};

export async function getAiDeptIds(): Promise<{ dept1Id: string | null; dept2Id: string | null }> {
  if (globalCache.__aiDeptIds) return globalCache.__aiDeptIds;
  const m = await getEcpMapping();
  if (!m.tables.department || !m.department) {
    globalCache.__aiDeptIds = { dept1Id: null, dept2Id: null };
    return globalCache.__aiDeptIds;
  }
  const D = sqlId(m.tables.department);
  const dId = sqlId(m.department.id);
  const dName = sqlId(m.department.name);

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `
      SELECT d.${dId} AS id, d.${dName} AS name
      FROM ${D} d
      WHERE d.${dName} LIKE '%AI專案一部%'
         OR d.${dName} LIKE '%AI專案二部%'
    `
  );

  const dept1 = rows.find((r) => String(r.name || '').includes('AI專案一部'))?.id || null;
  const dept2 = rows.find((r) => String(r.name || '').includes('AI專案二部'))?.id || null;
  globalCache.__aiDeptIds = { dept1Id: dept1, dept2Id: dept2 };
  return globalCache.__aiDeptIds;
}

/**
 * Build WHERE clause to filter users by department (DB-driven).
 * Uses TsUser.FDepartmentId to match AI專案一部/二部 instead of hardcoded name lists.
 * Also excludes users in EXCLUDED_USERS.
 */
export function buildWhitelistWhere(opts: {
  uName: string;
  uDeptId: string | null;
  uAccount: string | null;
  departmentId: string | null;
  dept1Id: string | null;
  dept2Id: string | null;
}) {
  const { uName, uDeptId, departmentId, dept1Id, dept2Id } = opts;
  const args: any[] = [];
  let where = '';

  // Department-based filtering using DB column
  if (uDeptId) {
    if (departmentId) {
      // Filter by specific department
      where += ` AND u.${uDeptId} = ?`;
      args.push(departmentId);
    } else if (dept1Id && dept2Id) {
      // Default: show both AI departments
      where += ` AND u.${uDeptId} IN (?, ?)`;
      args.push(dept1Id, dept2Id);
    } else if (dept1Id) {
      where += ` AND u.${uDeptId} = ?`;
      args.push(dept1Id);
    } else if (dept2Id) {
      where += ` AND u.${uDeptId} = ?`;
      args.push(dept2Id);
    }
  }

  // Exclude specific users
  if (EXCLUDED_USERS.length > 0) {
    const baseNameExpr = `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(u.${uName}, '（', 1), '(', 1))`;
    for (const name of EXCLUDED_USERS) {
      where += ` AND ${baseNameExpr} != ?`;
      args.push(name);
    }
  }

  return { where, args };
}
