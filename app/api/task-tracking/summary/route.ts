import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';

export const dynamic = 'force-dynamic';

// 執行中、審核中、延時執行中、自動升級中、延時申請中、逾時執行中、逾時自動升級中、返回修改中
const ALLOWED_STATUSES = [
  'Execute',        // 執行中 (service-request style)
  'Executing',      // 執行中 (task style)
  'Auditing',       // 審核中
  'OverdueExecute', // 延時執行中 (tentative)
  'AutoUpgrade',    // 自動升級中
  'Send',           // 延時申請中
  'Overdue',        // 逾時執行中
  'OverdueUpgrade', // 逾時自動升級中
  'Back',           // 返回修改中
];

// Exclude system/shared accounts
const EXCLUDED_USER_NAMES = [
  '系統檢查授權用帳號',
  'AI大夜共用-GIOC',
  'AI小夜共用-GIOC',
  'AI呂佳珍-gioc',
  'AI林佳蓉-GIOC',
  'cs_api',
  'qbiai_user',
];

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '10', 10)));
    const offset = (page - 1) * pageSize;

    const m = await getEcpMapping();
    const { dept1Id, dept2Id } = await getAiDeptIds();
    const plannedEndCol = await getTaskPlannedEndAtColumn();

    const T = sqlId(m.tables.task);
    const P = sqlId(m.tables.project);
    const U = sqlId(m.tables.user);

    const tId = sqlId(m.task.id);
    const tName = sqlId(m.task.name);
    const tProjectId = sqlId(m.task.projectId);
    const tStatus = m.task.status ? sqlId(m.task.status) : null;
    const tPlanEnd = sqlId(plannedEndCol || (m.task.plannedEndAt ?? 'FPredictEndDate'));
    const tAssignee = m.task.executorUserId
      ? sqlId(m.task.executorUserId)
      : m.task.ownerUserId
        ? sqlId(m.task.ownerUserId)
        : null;

    const pId = sqlId(m.project.id);
    const pName = sqlId(m.project.name);
    const pCode = m.project.code ? sqlId(m.project.code) : null;

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;

    if (!tAssignee) {
      return Response.json({ error: 'Missing task assignee mapping' }, { status: 500 });
    }

    // Filter tasks by people who handle service requests in this department
    // (same department scope as service-request dashboard)
    const deptIds = [dept1Id, dept2Id].filter(Boolean) as string[];
    let personWhere = '';
    const deptArgs: string[] = [];
    if (deptIds.length > 0) {
      const placeholders = deptIds.map(() => '?').join(', ');
      personWhere = ` AND t.${tAssignee} IN (
        SELECT DISTINCT sr.FUserId FROM \`TcServiceRequest\` sr
        WHERE sr.FDepartmentId IN (${placeholders}) AND sr.FUserId IS NOT NULL
      )`;
      deptArgs.push(...deptIds);
    }

    // Status inclusion filter
    const allowedList = ALLOWED_STATUSES.map((s) => `'${s}'`).join(', ');
    const activeWhere = tStatus
      ? ` AND t.${tStatus} IN (${allowedList}) AND t.${tPlanEnd} IS NOT NULL`
      : ` AND t.${tPlanEnd} IS NOT NULL`;

    // Exclude system accounts from display
    const excList = EXCLUDED_USER_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
    const userExclWhere =
      ` AND (u.${uName} NOT IN (${excList}) OR u.${uName} IS NULL)` +
      (uAccount ? ` AND (u.${uAccount} NOT IN (${excList}) OR u.${uAccount} IS NULL)` : '');

    const selectCols = `
      t.${tId} AS id,
      t.${tName} AS name,
      ${tStatus ? `t.${tStatus} AS status,` : `NULL AS status,`}
      t.${tPlanEnd} AS planEndDate,
      u.${uName} AS userName,
      ${pCode ? `p.${pCode} AS projectCode,` : `NULL AS projectCode,`}
      p.${pName} AS projectName
    `;

    const joinClause = `
      FROM ${T} t
      LEFT JOIN ${U} u ON u.${uId} = t.${tAssignee}
      LEFT JOIN ${P} p ON p.${pId} = t.${tProjectId}
    `;

    const overdueWhere = `${personWhere}${activeWhere}${userExclWhere} AND t.${tPlanEnd} < NOW()`;
    const upcomingWhere = `${personWhere}${activeWhere}${userExclWhere} AND t.${tPlanEnd} >= NOW() AND t.${tPlanEnd} < DATE_ADD(NOW(), INTERVAL 7 DAY)`;

    const [overdueCountRows, upcomingCountRows] = await Promise.all([
      (prisma.$queryRawUnsafe as any)(
        `SELECT COUNT(1) AS cnt ${joinClause} WHERE 1=1 ${overdueWhere}`,
        ...deptArgs
      ) as Promise<Array<{ cnt: bigint }>>,
      (prisma.$queryRawUnsafe as any)(
        `SELECT COUNT(1) AS cnt ${joinClause} WHERE 1=1 ${upcomingWhere}`,
        ...deptArgs
      ) as Promise<Array<{ cnt: bigint }>>,
    ]);

    const overdueTotal = Number(overdueCountRows[0]?.cnt ?? 0);
    const upcomingTotal = Number(upcomingCountRows[0]?.cnt ?? 0);

    const [overdueRows, upcomingRows] = await Promise.all([
      (prisma.$queryRawUnsafe as any)(
        `SELECT ${selectCols} ${joinClause} WHERE 1=1 ${overdueWhere} ORDER BY t.${tPlanEnd} ASC LIMIT ? OFFSET ?`,
        ...deptArgs, pageSize, offset
      ) as Promise<any[]>,
      (prisma.$queryRawUnsafe as any)(
        `SELECT ${selectCols} ${joinClause} WHERE 1=1 ${upcomingWhere} ORDER BY t.${tPlanEnd} ASC`,
        ...deptArgs
      ) as Promise<any[]>,
    ]);

    const fmt = (rows: any[]) =>
      rows.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? ''),
        status: r.status ? String(r.status) : null,
        planEndDate: fmtDatetime(r.planEndDate),
        userName: r.userName ? String(r.userName) : null,
        projectCode: r.projectCode ? String(r.projectCode) : null,
        projectName: r.projectName ? String(r.projectName) : null,
      }));

    return Response.json({
      overdue: fmt(overdueRows),
      overdueTotal,
      overduePage: page,
      overduePageSize: pageSize,
      upcoming: fmt(upcomingRows),
      upcomingTotal,
    });
  } catch (e: any) {
    console.error('[task-tracking/summary]', e);
    return Response.json({ error: e?.message ?? 'unknown error' }, { status: 500 });
  }
}
