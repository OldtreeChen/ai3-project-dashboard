import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export type DeptWhitelist = { deptName: string; emails: string[]; names: string[] };

// Excluded users: { name, dept? }
// If dept is specified, only exclude from that department
// If dept is omitted, exclude from all departments
type ExcludedUser = { name: string; dept?: 'dept1' | 'dept2' };

export const EXCLUDED_USERS: ExcludedUser[] = [
  // 全部門排除
  { name: '陳治瑋' },
  { name: '沈子欽' },
  { name: '丁奕荳' },
  { name: '吳宗憲' },
  { name: '吳柚彤' },
  { name: '呂思潁' },
  { name: '周禹丞' },
  { name: '廖偉彤' },
  { name: '周儀' },
  { name: '張銘介' },
  { name: '張達明' },
  { name: '徐珮芳' },
  { name: '李若菲' },
  { name: '游志鴻' },
  { name: '范綱恒' },
  { name: '葉后儀' },
  { name: '蔡佳晏' },
  { name: '許光軒' },
  { name: '許如蕙' },
  { name: '邱欣怡' },
  { name: '何子杰' },
  { name: '吳佳勳' },
  { name: '廖冠富' },
  { name: '江昱儒' },
  { name: '江浩志' },
  { name: '胡妤安' },
  { name: '葉德懋' },
  { name: '董妙珍' },
  { name: '鄭淑娟' },
  { name: '陳建翔' },
  { name: '葉修文' },
  // 僅排除特定部門
  { name: '廖明信', dept: 'dept1' },  // 專案一部排除，二部保留
  { name: '陳慕霖', dept: 'dept2' },  // 專案二部排除，一部保留
  { name: '鄭翔之', dept: 'dept1' },  // 專案一部排除
  { name: '高仲揚', dept: 'dept1' },  // 專案一部排除
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
    for (const ex of EXCLUDED_USERS) {
      if (!ex.dept) {
        // Exclude from all departments
        where += ` AND ${baseNameExpr} != ?`;
        args.push(ex.name);
      } else if (uDeptId) {
        // Exclude only from specific department
        const targetDeptId = ex.dept === 'dept1' ? dept1Id : dept2Id;
        if (targetDeptId) {
          where += ` AND NOT (${baseNameExpr} = ? AND u.${uDeptId} = ?)`;
          args.push(ex.name, targetDeptId);
        }
      }
    }
  }

  return { where, args };
}
