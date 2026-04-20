import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getProjectOwnerColumn } from '@/lib/projectOwner';
import { getUserActiveFilter } from '@/lib/userActive';
import { parseIdParam } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = `'Assigned','New','Executing','ExecuteAuditing','ExecuteBack','Overdue','OverdueUpgrade','AutoUpgrade','Finished'`;

function getMonthRange(monthParam?: string | null) {
  let yyyy: number, mm: number;
  if (monthParam) {
    const mat = monthParam.match(/^(\d{4})-(\d{2})$/);
    if (mat) { yyyy = Number(mat[1]); mm = Number(mat[2]); }
    else { const now = new Date(); yyyy = now.getFullYear(); mm = now.getMonth() + 1; }
  } else {
    const now = new Date();
    yyyy = now.getFullYear();
    mm = now.getMonth() + 1;
  }
  const start = `${yyyy}-${String(mm).padStart(2, '0')}-01`;
  const next = new Date(yyyy, mm, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  const label = `${yyyy}-${String(mm).padStart(2, '0')}`;
  return { yyyy, mm, start, end, label };
}

const toDateStr = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}/.test(s) ? s.slice(0, 10) : null;
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const departmentId = parseIdParam(url.searchParams.get('departmentId'));
    const month = getMonthRange(url.searchParams.get('month'));

    const m = await getEcpMapping();
    const P = sqlId(m.tables.project);
    const U = sqlId(m.tables.user);
    const D = m.tables.department ? sqlId(m.tables.department) : null;

    const pId = sqlId(m.project.id);
    const pName = sqlId(m.project.name);
    const pStatus = m.project.status ? sqlId(m.project.status) : null;
    const pDeptId = m.project.departmentId ? sqlId(m.project.departmentId) : null;
    const ownerCol = await getProjectOwnerColumn();
    const pOwner = ownerCol ? sqlId(ownerCol) : null;

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
    const dId = m.department?.id ? sqlId(m.department.id) : null;
    const dName = m.department?.name ? sqlId(m.department.name) : null;

    if (!pStatus) return Response.json({ month: month.label, goLive: [], acceptance: [] });

    const projectDeptJoin = D && dId && dName && pDeptId
      ? `LEFT JOIN ${D} dp ON dp.${dId} = p.${pDeptId}` : '';
    const projectDeptFilter = D && dId && dName && pDeptId
      ? `AND (dp.${dName} LIKE '%AI專案一部%' OR dp.${dName} LIKE '%AI專案二部%')` : '';
    const ownerJoin = pOwner
      ? `LEFT JOIN ${U} u ON u.${uId} = p.${pOwner}` : '';
    const ownerDeptJoin = D && dId && dName && uDeptId
      ? `LEFT JOIN ${D} od ON od.${dId} = u.${uDeptId}` : '';

    const activeFilter = await getUserActiveFilter(m.tables.user, 'u');
    const deptFilter = departmentId && pDeptId ? `AND p.${pDeptId} = ?` : '';
    const deptArgs: string[] = departmentId && pDeptId ? [departmentId] : [];

    // ── Query 1: milestones with 上線/驗收 in name, scheduled this month ──
    const milestoneSql = `
      SELECT
        ms.FId          AS id,
        ms.FName        AS milestone_name,
        p.${pId}        AS project_id,
        p.${pName}      AS project_name,
        p.${pStatus}    AS project_status,
        ms.FFinishDate  AS plan_date,
        ms.FFirstFinishDate AS original_date,
        ms.FStatus      AS ms_status,
        ${pOwner ? `u.${uName} AS owner_name,` : 'NULL AS owner_name,'}
        ${D && dId && dName && pDeptId ? `dp.${dName} AS dept_name` : 'NULL AS dept_name'}
      FROM TcProjectMilestone ms
      JOIN ${P} p ON p.${pId} = ms.FProjectId
      ${projectDeptJoin}
      ${ownerJoin}
      ${ownerDeptJoin}
      WHERE (ms.FName LIKE '%上線%' OR ms.FName LIKE '%驗收%')
        AND ms.FFinishDate >= ? AND ms.FFinishDate < ?
        AND (ms.FStatus IS NULL OR ms.FStatus NOT IN ('Cancel','Discarded'))
        AND p.${pName} NOT LIKE '%新人%'
        AND (p.${pName} LIKE '【AI】%' OR p.${pName} LIKE 'AI】%')
        AND p.${pStatus} IN (${ACTIVE_STATUSES})
        ${projectDeptFilter}
        ${deptFilter}
        ${activeFilter.where}
      ORDER BY ms.FFinishDate ASC, ms.FName ASC
    `;
    const milestoneArgs = [month.start, month.end, ...deptArgs];
    const milestoneRows = await prisma.$queryRawUnsafe<any[]>(milestoneSql, ...milestoneArgs);

    if (!milestoneRows.length) {
      return Response.json({
        month: month.label,
        date_range: { from: month.start, to_exclusive: month.end },
        goLive: [],
        acceptance: [],
      });
    }

    // ── Query 2: delay records this month for these milestones ──
    const ids = milestoneRows.map((r) => String(r.id));
    const idPlaceholders = ids.map(() => '?').join(',');

    const delaySql = `
      SELECT
        d.FProjectMilestoneId AS milestone_id,
        d.FMilestonePlanEndDate AS old_date,
        d.FNewEndDate           AS new_date,
        d.FCreateTime           AS changed_at,
        d.FReason               AS reason,
        d.FDelayType            AS delay_type
      FROM TcProjectMilestoneDelay d
      WHERE d.FProjectMilestoneId IN (${idPlaceholders})
        AND d.FCreateTime >= ? AND d.FCreateTime < ?
      ORDER BY d.FProjectMilestoneId ASC, d.FCreateTime ASC
    `;
    const delayRows = await prisma.$queryRawUnsafe<any[]>(delaySql, ...ids, month.start, month.end);

    // Group delays by milestone id, keep only distinct old→new pairs
    const delayMap = new Map<string, { old_date: string; new_date: string | null; changed_at: string; reason: string | null; delay_type: string | null }[]>();
    const seenPairs = new Map<string, Set<string>>();
    for (const d of delayRows) {
      const mid = String(d.milestone_id);
      if (!delayMap.has(mid)) { delayMap.set(mid, []); seenPairs.set(mid, new Set()); }
      const od = toDateStr(d.old_date);
      const nd = toDateStr(d.new_date);
      const key = `${od}→${nd}`;
      if (od && !seenPairs.get(mid)!.has(key)) {
        seenPairs.get(mid)!.add(key);
        delayMap.get(mid)!.push({
          old_date: od,
          new_date: nd,
          changed_at: d.changed_at instanceof Date ? d.changed_at.toISOString().slice(0, 10) : String(d.changed_at ?? '').slice(0, 10),
          reason: d.reason ? String(d.reason) : null,
          delay_type: d.delay_type ? String(d.delay_type) : null,
        });
      }
    }

    const goLive: any[] = [];
    const acceptance: any[] = [];

    for (const r of milestoneRows) {
      const id = String(r.id);
      const planDate = toDateStr(r.plan_date);
      const delays = delayMap.get(id) ?? [];

      // "date_changed_from": earliest delay old_date that differs from current plan_date
      let dateChangedFrom: string | null = null;
      for (const d of delays) {
        if (d.old_date && d.old_date !== planDate) {
          dateChangedFrom = d.old_date;
          break;
        }
      }

      const row = {
        id,
        milestone_name: String(r.milestone_name || ''),
        project_id: String(r.project_id),
        project_name: String(r.project_name || ''),
        project_status: r.project_status ? String(r.project_status) : null,
        plan_date: planDate,
        ms_status: r.ms_status ? String(r.ms_status) : null,
        owner_name: r.owner_name ? String(r.owner_name) : null,
        dept_name: r.dept_name ? String(r.dept_name) : null,
        date_changed_from: dateChangedFrom,
        changes: delays,
      };

      if (row.milestone_name.includes('驗收')) {
        acceptance.push(row);
      } else {
        goLive.push(row);
      }
    }

    const calcRate = (items: any[]) => {
      const total = items.length;
      const finished = items.filter((x) => x.ms_status === 'Finished').length;
      const rate = total > 0 ? Math.round((finished / total) * 100) : 0;
      return { total, finished, rate };
    };

    return Response.json({
      month: month.label,
      date_range: { from: month.start, to_exclusive: month.end },
      goLive,
      acceptance,
      goLiveStats: calcRate(goLive),
      acceptanceStats: calcRate(acceptance),
    });
  } catch (err: any) {
    const message = err?.message ? String(err.message) : 'unknown error';
    return Response.json({ ok: false, error: message, goLive: [], acceptance: [] }, { status: 500 });
  }
}
