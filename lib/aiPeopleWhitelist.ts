import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export type DeptWhitelist = { deptName: string; emails: string[]; names: string[] };

// Excluded users: { name, dept?, excludeFrom? }
// dept: only exclude from that department (omit = all depts)
// excludeFrom: array of dashboard scopes to exclude from (omit = all scopes)
// Scopes: 'pm' | 'dept-month' | 'attendance' | 'checkin' | 'project' | 'people'
export type DashboardScope = 'pm' | 'dept-month' | 'attendance' | 'checkin' | 'project' | 'people';
type ExcludedUser = { name: string; dept?: 'dept1' | 'dept2'; excludeFrom?: DashboardScope[] };

export const EXCLUDED_USERS: ExcludedUser[] = [
  // 全部門、全儀表板排除
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
  { name: '葉德懋' },
  { name: '董妙珍' },
  { name: '鄭淑娟' },
  { name: '陳建翔' },
  { name: '葉修文' },
  // 僅排除 PM/專案相關儀表板，納入 dept-month/attendance/checkin
  { name: '何子杰', excludeFrom: ['pm', 'project', 'people'] },
  { name: '吳佳勳', excludeFrom: ['pm', 'project', 'people'] },
  { name: '廖冠富', excludeFrom: ['pm', 'project', 'people'] },
  { name: '江昱儒', excludeFrom: ['pm', 'project', 'people'] },
  { name: '江浩志', excludeFrom: ['pm', 'project', 'people'] },
  { name: '胡妤安', excludeFrom: ['pm', 'project', 'people'] },
  // 僅排除 dept-month/attendance/checkin，納入 PM 負載彙總表
  { name: '陳治瑋', excludeFrom: ['dept-month', 'attendance', 'checkin', 'people'] },
  { name: '陳慕霖', excludeFrom: ['dept-month', 'attendance', 'checkin', 'people'] },
  // 僅排除特定部門
  { name: '廖明信', dept: 'dept1' },  // 專案一部排除，二部保留
  { name: '鄭翔之', dept: 'dept1' },  // 專案一部排除
  { name: '高仲揚', dept: 'dept1' },  // 專案一部排除
];

/**
 * Filter EXCLUDED_USERS by dashboard scope.
 * Returns only users that should be excluded for the given scope.
 */
export function getExcludedForScope(scope?: DashboardScope): ExcludedUser[] {
  if (!scope) return EXCLUDED_USERS; // no scope = exclude all
  return EXCLUDED_USERS.filter((ex) => {
    if (!ex.excludeFrom) return true; // no excludeFrom = exclude from all scopes
    return ex.excludeFrom.includes(scope);
  });
}

const globalCache = globalThis as unknown as {
  __aiDeptIds?: { dept1Id: string | null; dept2Id: string | null; allDeptIds: string[] };
};

export async function getAiDeptIds(): Promise<{
  dept1Id: string | null;
  dept2Id: string | null;
  allDeptIds: string[];
}> {
  if (globalCache.__aiDeptIds) return globalCache.__aiDeptIds;
  const m = await getEcpMapping();
  if (!m.tables.department || !m.department) {
    globalCache.__aiDeptIds = { dept1Id: null, dept2Id: null, allDeptIds: [] };
    return globalCache.__aiDeptIds;
  }
  const D = sqlId(m.tables.department);
  const dId = sqlId(m.department.id);
  const dName = sqlId(m.department.name);

  // Use ALLOWED_DEPTS env var if set (e.g. dept-rd deployment),
  // otherwise fall back to the default AI專案一部 / AI專案二部.
  const allowedDepts: string[] = process.env.ALLOWED_DEPTS
    ? process.env.ALLOWED_DEPTS.split(',').map((d) => d.trim()).filter(Boolean)
    : ['AI專案一部', 'AI專案二部'];

  const inList = allowedDepts.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `SELECT d.${dId} AS id, d.${dName} AS name FROM ${D} d WHERE d.${dName} IN (${inList})`
  );

  // Collect ALL matching IDs (handles duplicate department names across org units)
  const allDeptIds = rows.map((r) => String(r.id)).filter(Boolean);
  const dept1 = rows.find((r) => String(r.name || '') === allowedDepts[0])?.id || null;
  const dept2 = allowedDepts[1]
    ? (rows.find((r) => String(r.name || '') === allowedDepts[1])?.id || null)
    : null;
  globalCache.__aiDeptIds = { dept1Id: dept1, dept2Id: dept2, allDeptIds };
  return globalCache.__aiDeptIds;
}

/**
 * Build WHERE clause to filter users by department (DB-driven).
 * Uses TsUser.FDepartmentId to match allowed departments.
 * Also excludes users in EXCLUDED_USERS.
 */
export function buildWhitelistWhere(opts: {
  uName: string;
  uDeptId: string | null;
  uAccount: string | null;
  departmentId: string | null;
  dept1Id: string | null;
  dept2Id: string | null;
  allDeptIds?: string[];
  scope?: DashboardScope;
}) {
  const { uName, uDeptId, departmentId, dept1Id, dept2Id, allDeptIds, scope } = opts;
  const args: any[] = [];
  let where = '';

  // Department-based filtering using DB column
  if (uDeptId) {
    if (departmentId) {
      // Specific dept selected from dropdown
      where += ` AND u.${uDeptId} = ?`;
      args.push(departmentId);
    } else {
      // Default view: use all dept IDs if available, else fall back to dept1/dept2
      const ids = allDeptIds && allDeptIds.length > 0
        ? allDeptIds
        : [dept1Id, dept2Id].filter(Boolean) as string[];
      if (ids.length === 1) {
        where += ` AND u.${uDeptId} = ?`;
        args.push(ids[0]);
      } else if (ids.length > 1) {
        where += ` AND u.${uDeptId} IN (${ids.map(() => '?').join(', ')})`;
        args.push(...ids);
      }
    }
  }

  // Exclude specific users (filtered by scope)
  const excludedList = getExcludedForScope(scope);
  if (excludedList.length > 0) {
    const baseNameExpr = `TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(u.${uName}, '（', 1), '(', 1), '-', 1))`;
    for (const ex of excludedList) {
      if (!ex.dept) {
        where += ` AND ${baseNameExpr} != ?`;
        args.push(ex.name);
      } else if (uDeptId) {
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
