import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskReceivedAtColumn } from '@/lib/taskReceivedAt';
import { getUserActiveFilter } from '@/lib/userActive';
import { getTaskPlannedHoursColumn } from '@/lib/taskPlannedHours';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';
import { getTaskPlannedStartAtColumn } from '@/lib/taskPlannedStartAt';
import { buildWhitelistWhere, getAiDeptIds } from '@/lib/aiPeopleWhitelist';
import { parseIdParam } from '../../_utils';

export const dynamic = 'force-dynamic';

function parseMonthParam(v: string | null) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || yyyy < 1900 || yyyy > 2500 || mm < 1 || mm > 12) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const next = new Date(yyyy, mm, 1); // JS: month is 0-based; mm already 1-12 so this is next month
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { yyyy, mm, start, end };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const month = parseMonthParam(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid month (expected YYYY-MM)' }, { status: 400 });

    const departmentId = parseIdParam(url.searchParams.get('departmentId'));
    // personId filter removed from UI; keep param only for backward compatibility
    const personId = parseIdParam(url.searchParams.get('personId'));

    const m = await getEcpMapping();
    const receivedAtCol = await getTaskReceivedAtColumn();
    const plannedHoursCol = await getTaskPlannedHoursColumn();
    const plannedStartCol = await getTaskPlannedStartAtColumn();
    const plannedEndCol = await getTaskPlannedEndAtColumn();

    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const TR = sqlId(m.tables.time);
    const U = sqlId(m.tables.user);
    const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;

    const tId = sqlId(m.task.id);
    const tProjectId = sqlId(m.task.projectId);
    // 部門/人員任務：以「任務執行人」為準（不是任務下達人）
    const tAssigneeRaw = m.task.executorUserId || m.task.ownerUserId;
    const tAssignee = tAssigneeRaw ? sqlId(tAssigneeRaw) : null;
    const tPlanned = plannedHoursCol ? sqlId(plannedHoursCol) : (m.task.plannedHours ? sqlId(m.task.plannedHours) : null);
    const tActual = m.task.actualHours ? sqlId(m.task.actualHours) : null;
    const tReceivedAt = sqlId(receivedAtCol);
    const tPlanStart = plannedStartCol ? sqlId(plannedStartCol) : null;
    const tPlanEnd = plannedEndCol ? sqlId(plannedEndCol) : null;
    const tStatus = m.task.status ? sqlId(m.task.status) : null;

    const trTaskId = sqlId(m.time.taskId);
    const trUserId = sqlId(m.time.userId);
    const trHours = sqlId(m.time.hours);
    const trTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;
    const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
    const thWorkDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uAccount = m.user.account ? sqlId(m.user.account) : null;
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

    const pId = sqlId(m.project.id);
    const pName = sqlId(m.project.name);

    if (!tAssignee) {
      return Response.json(
        { error: 'task.executorUserId/ownerUserId is not mapped; please set ecp.columns.task.executorUserId in config.json' },
        { status: 500 }
      );
    }

    const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';

    // 「已執行」：依工時日誌明細（該月）統計，避免拿任務累積實際時數造成跨月虛報
    if (!(TH && trTimeReportId && thId && thWorkDate)) {
      return Response.json({ error: 'timeReport/timeDetail mapping missing (need timeReportId + workDate)' }, { status: 500 });
    }
    const usedSql = `
      SELECT
        tr.${trTaskId} AS task_id,
        tr.${trUserId} AS person_id,
        COALESCE(SUM(tr.${trHours}), 0) AS used_hours
      FROM ${TR} tr
      LEFT JOIN ${TH} th ON th.${thId} = tr.${trTimeReportId}
      WHERE th.${thWorkDate} >= ? AND th.${thWorkDate} < ?
      GROUP BY tr.${trTaskId}, tr.${trUserId}
    `;

    // Month allocation rule:
    // - task belongs to month if [start,end] overlaps [month.start, month.end)
    // - planned hours allocated by day proportion: planned * overlapDays / totalDays
    // Fallback: if planned start is missing, use receivedAt as start; if planned end missing, use receivedAt as end.
    const startExpr = tPlanStart ? `COALESCE(t.${tPlanStart}, t.${tReceivedAt})` : `t.${tReceivedAt}`;
    const endExpr = tPlanEnd ? `COALESCE(t.${tPlanEnd}, t.${tReceivedAt})` : `t.${tReceivedAt}`;

    let sql = `
      SELECT
        u.${uId} AS person_id,
        u.${uName} AS display_name
        ${uDeptId ? `,u.${uDeptId} AS department_id` : `,NULL AS department_id`},
        COUNT(ti.task_id) AS task_count,
        COALESCE(SUM(COALESCE(ti.planned_hours, 0)), 0) AS received_total_hours,
        COALESCE(SUM(COALESCE(us.used_hours, 0)), 0) AS used_hours,
        COALESCE(SUM(COALESCE(ti.planned_hours, 0)), 0) - COALESCE(SUM(COALESCE(us.used_hours, 0)), 0) AS remaining_hours
      FROM ${U} u
      LEFT JOIN (
        SELECT
          t.${tId} AS task_id,
          t.${tAssignee} AS person_id,
          (
            ${plannedExpr} *
            GREATEST(
              DATEDIFF(
                LEAST(DATE(${endExpr}), DATE_SUB(DATE(?), INTERVAL 1 DAY)),
                GREATEST(DATE(${startExpr}), DATE(?))
              ) + 1,
              0
            ) /
            GREATEST(DATEDIFF(DATE(${endExpr}), DATE(${startExpr})) + 1, 1)
          ) AS planned_hours
        FROM ${T} t
        LEFT JOIN ${P} p ON p.${pId} = t.${tProjectId}
        WHERE t.${tAssignee} IS NOT NULL AND t.${tAssignee} <> ''
          ${tStatus ? `AND (t.${tStatus} IS NULL OR t.${tStatus} NOT IN ('Discarded','Cancel'))` : ''}
          AND p.${pName} NOT LIKE ?
          AND DATE(${startExpr}) < DATE(?)
          AND DATE(${endExpr}) >= DATE(?)
      ) ti ON ti.person_id = u.${uId}
      LEFT JOIN (
        ${usedSql}
      ) us ON us.task_id = ti.task_id AND us.person_id = u.${uId}
      WHERE 1=1
    `;

    // placeholders order:
    // 1-2: planned overlap calc
    // 3-4: overlap WHERE
    // 5-6: used hours month filter
    // placeholders order:
    // 1-2: planned overlap calc
    // 3: exclude newbie projects (p.name NOT LIKE)
    // 4-5: overlap WHERE
    // 6-7: used hours month filter
    const args: Array<string> = [month.end, month.start, '%新人%', month.end, month.start, month.start, month.end];
    // exclude system/service users + disabled/deleted users
    sql += ` AND u.${uName} NOT LIKE ? AND u.${uName} NOT LIKE ?`;
    args.push('%MidECP-User%', '%service_user%');
    const active = await getUserActiveFilter(m.tables.user, 'u');
    sql += active.where;

    // apply department-based filter + excluded users
    const { dept1Id, dept2Id } = await getAiDeptIds();
    const wl = buildWhitelistWhere({
      uName: String(uName),
      uDeptId: uDeptId ? String(uDeptId) : null,
      uAccount: uAccount ? String(uAccount) : null,
      departmentId: departmentId || null,
      dept1Id,
      dept2Id
    });
    sql += wl.where;
    args.push(...wl.args);

    if (personId) {
      sql += ` AND u.${uId} = ?`;
      args.push(personId);
    }

    sql += `
      GROUP BY u.${uId}
      ORDER BY remaining_hours DESC, received_total_hours DESC, u.${uName} ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // normalize BigInt aggregates for JSON safety
    const normalized = rows.map((r) => ({
      ...r,
      task_count: Number(r.task_count || 0),
      received_total_hours: Number(r.received_total_hours || 0),
      used_hours: Number(r.used_hours || 0),
      remaining_hours: Number(r.remaining_hours || 0)
    }));

    // de-dupe by normalized display name (avoid listing same person twice)
    const seen = new Set<string>();
    const people: any[] = [];
    for (const r of normalized) {
      const name = String(r.display_name ?? '').trim();
      if (!name) continue;
      const key = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        people.push(r);
        continue;
      }
      // if duplicate exists, keep the row with more activity (avoid losing data)
      const idx = people.findIndex((x) => String(x.display_name ?? '').trim().replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase() === key);
      if (idx >= 0) {
        const cur = people[idx];
        const curScore = Number(cur.used_hours || 0) + Number(cur.received_total_hours || 0) + Number(cur.task_count || 0);
        const nextScore = Number(r.used_hours || 0) + Number(r.received_total_hours || 0) + Number(r.task_count || 0);
        if (nextScore > curScore) people[idx] = r;
      }
    }

    // keep unused vars referenced (avoid tree-shaking confusion) — also confirms table compiles
    void P;
    void tProjectId;

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      received_at_column: { table: m.tables.task, column: receivedAtCol },
      planned_hours_column: { table: m.tables.task, column: plannedHoursCol },
      planned_start_column: { table: m.tables.task, column: plannedStartCol },
      planned_end_column: { table: m.tables.task, column: plannedEndCol },
      executed_hours_source: { table: m.tables.time, column: m.time.hours, month_filter: { table: m.tables.timeReport || null, column: m.timeReport?.workDate || null } },
      allocation: { method: 'overlap_days / total_days', unit: 'calendar_days', note: '接收總時數=該月任務預估(均攤)' },
      filters: { departmentId: departmentId || null, personId: personId || null },
      people
    });
  } catch (err: any) {
    const message = err?.message ? String(err.message) : 'unknown error';
    return Response.json(
      {
        ok: false,
        error: message,
        hint: [
          '通常是「接收日期欄位」偵測不到，或 ecp.columns 對應需要在 config.json 明確指定。',
          '你可以先開 /schema 查 TcTask 的日期欄位，再把 receivedAt 寫進 config.json：',
          '{ "ecp": { "columns": { "task": { "receivedAt": "FFirstCommitmentDate" }}}}'
        ]
      },
      { status: 500 }
    );
  }
}


