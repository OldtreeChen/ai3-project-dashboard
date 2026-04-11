import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getAiDeptIds } from '@/lib/aiPeopleWhitelist';

export const dynamic = 'force-dynamic';

function fmtDatetime(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    const h = String(v.getHours()).padStart(2, '0');
    const mi = String(v.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${d} ${h}:${mi}`;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 16);
  return null;
}

// 執行中、審核中、自動升級中、延時申請中、逾時執行中、逾時自動升級中、返回修改中
const ALLOWED_STATUSES = [
  'Execute',        // 執行中
  'Auditing',       // 審核中
  'AutoUpgrade',    // 自動升級中
  'Delay',          // 延時申請中
  'Overdue',        // 逾時執行中
  'OverdueUpgrade', // 逾時自動升級中
  'Back',           // 返回修改中
];

// Exclude system/shared accounts by display name or account
const EXCLUDED_USER_NAMES = [
  '系統檢查授權用帳號',
  'AI大夜共用-GIOC',
  'AI小夜共用-GIOC',
  'AI呂佳珍-gioc',
  'AI林佳蓉-GIOC',
  'cs_api',
  'qbiai_user',
  '李一新',
];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '10', 10)));
    const offset = (page - 1) * pageSize;

    const m = await getEcpMapping();
    const { dept1Id, dept2Id } = await getAiDeptIds();

    const U = sqlId(m.tables.user);
    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;

    const SR = '`TcServiceRequest`';
    const D = '`TsDepartment`';

    // Department filter
    const deptIds = [dept1Id, dept2Id].filter(Boolean) as string[];
    let deptWhere = '';
    const deptArgs: string[] = [];
    if (deptIds.length > 0) {
      const placeholders = deptIds.map(() => '?').join(', ');
      deptWhere = ` AND sr.FDepartmentId IN (${placeholders})`;
      deptArgs.push(...deptIds);
    }

    // Status inclusion filter
    const allowedList = ALLOWED_STATUSES.map((s) => `'${s}'`).join(', ');
    const activeWhere = ` AND sr.FStatus IN (${allowedList}) AND sr.FPlanEndDate IS NOT NULL`;

    // Use LIKE so names with job-title suffixes are also excluded
    const nameLikeClauses = EXCLUDED_USER_NAMES.map(
      (n) => `u.${uName} NOT LIKE '${n.replace(/'/g, "''")}%'`
    ).join(' AND ');
    const userExclWhere = ` AND (${nameLikeClauses} OR u.${uName} IS NULL)` +
      (uAccount ? ` AND (u.${uAccount} NOT IN (${EXCLUDED_USER_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ')}) OR u.${uAccount} IS NULL)` : '');

    // Overdue: FPlanEndDate < NOW()
    const overdueWhere = `${deptWhere}${activeWhere}${userExclWhere} AND sr.FPlanEndDate < NOW()`;

    // Upcoming 7 days
    const upcomingWhere = `${deptWhere}${activeWhere}${userExclWhere} AND sr.FPlanEndDate >= NOW() AND sr.FPlanEndDate < DATE_ADD(NOW(), INTERVAL 7 DAY)`;

    // All active (for person stats)
    const allActiveWhere = `${deptWhere}${activeWhere}${userExclWhere}`;

    const selectCols = `
      sr.FId AS id,
      sr.FName AS name,
      sr.FStatus AS status,
      sr.FPlanEndDate AS planEndDate,
      sr.FPriority AS priority,
      sr.FCreateTime AS createTime,
      u.${uName} AS userName,
      d.FName AS deptName
    `;

    const joinClause = `
      FROM ${SR} sr
      LEFT JOIN ${U} u ON u.${uId} = sr.FUserId
      LEFT JOIN ${D} d ON d.FId = sr.FDepartmentId
    `;

    const [overdueCountRows, upcomingCountRows, personStatsRows] = await Promise.all([
      (prisma.$queryRawUnsafe as any)(
        `SELECT COUNT(1) AS cnt ${joinClause} WHERE 1=1 ${overdueWhere}`,
        ...deptArgs
      ) as Promise<Array<{ cnt: bigint }>>,
      (prisma.$queryRawUnsafe as any)(
        `SELECT COUNT(1) AS cnt ${joinClause} WHERE 1=1 ${upcomingWhere}`,
        ...deptArgs
      ) as Promise<Array<{ cnt: bigint }>>,
      (prisma.$queryRawUnsafe as any)(
        `SELECT u.${uName} AS userName, sr.FStatus AS status, COUNT(1) AS cnt
         ${joinClause} WHERE 1=1 ${allActiveWhere}
         GROUP BY u.${uName}, sr.FStatus
         ORDER BY u.${uName} ASC`,
        ...deptArgs
      ) as Promise<Array<{ userName: string | null; status: string; cnt: bigint }>>,
    ]);

    const overdueTotal = Number(overdueCountRows[0]?.cnt ?? 0);
    const upcomingTotal = Number(upcomingCountRows[0]?.cnt ?? 0);

    const [overdueRows, upcomingRows] = await Promise.all([
      (prisma.$queryRawUnsafe as any)(
        `SELECT ${selectCols} ${joinClause} WHERE 1=1 ${overdueWhere} ORDER BY sr.FPlanEndDate ASC LIMIT ? OFFSET ?`,
        ...deptArgs, pageSize, offset
      ) as Promise<any[]>,
      (prisma.$queryRawUnsafe as any)(
        `SELECT ${selectCols} ${joinClause} WHERE 1=1 ${upcomingWhere} ORDER BY sr.FPlanEndDate ASC`,
        ...deptArgs
      ) as Promise<any[]>,
    ]);

    const fmt = (rows: any[]) =>
      rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        status: String(r.status ?? ''),
        planEndDate: fmtDatetime(r.planEndDate),
        priority: r.priority != null ? String(r.priority) : null,
        createTime: fmtDatetime(r.createTime),
        userName: r.userName ? String(r.userName) : null,
        deptName: r.deptName ? String(r.deptName) : null,
      }));

    const personStats = personStatsRows.map((r) => ({
      userName: r.userName ? String(r.userName) : '(未知)',
      status: String(r.status ?? ''),
      cnt: Number(r.cnt ?? 0),
    }));

    return Response.json({
      overdue: fmt(overdueRows),
      overdueTotal,
      overduePage: page,
      overduePageSize: pageSize,
      upcoming: fmt(upcomingRows),
      upcomingTotal,
      personStats,
    });
  } catch (e: any) {
    console.error('[service-requests/summary]', e);
    return Response.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}
