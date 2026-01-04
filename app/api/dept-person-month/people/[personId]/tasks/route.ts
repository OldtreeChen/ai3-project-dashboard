import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskReceivedAtColumn } from '@/lib/taskReceivedAt';
import { getTaskPlannedEndAtColumn } from '@/lib/taskPlannedEndAt';
import { getTaskPlannedHoursColumn } from '@/lib/taskPlannedHours';

export const dynamic = 'force-dynamic';

function parseMonthParam(v: string | null) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || yyyy < 1900 || yyyy > 2500 || mm < 1 || mm > 12) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const next = new Date(yyyy, mm, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { yyyy, mm, start, end };
}

export async function GET(req: Request, ctx: { params: Promise<{ personId: string }> }) {
  try {
    const { personId: personIdRaw } = await ctx.params;
    const personId = String(personIdRaw || '').trim();
    if (!personId) return Response.json({ error: 'invalid personId' }, { status: 400 });

    const url = new URL(req.url);
    const month = parseMonthParam(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid month (expected YYYY-MM)' }, { status: 400 });

    const m = await getEcpMapping();
    const receivedAtCol = await getTaskReceivedAtColumn();
    const plannedEndCol = await getTaskPlannedEndAtColumn();
    const plannedHoursCol = await getTaskPlannedHoursColumn();

    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const TR = sqlId(m.tables.time);
    const TH = m.tables.timeReport ? sqlId(m.tables.timeReport) : null;

    const pId = sqlId(m.project.id);
    const pCode = m.project.code ? sqlId(m.project.code) : null;
    const pName = sqlId(m.project.name);

    const tId = sqlId(m.task.id);
    const tProjectId = sqlId(m.task.projectId);
    const tName = sqlId(m.task.name);
    const tOwner = m.task.ownerUserId ? sqlId(m.task.ownerUserId) : null;
    const tPlanned = plannedHoursCol ? sqlId(plannedHoursCol) : (m.task.plannedHours ? sqlId(m.task.plannedHours) : null);
    const tStatus = m.task.status ? sqlId(m.task.status) : null;
    const tReceivedAt = sqlId(receivedAtCol);
    const tPlannedEndAt = plannedEndCol ? sqlId(plannedEndCol) : null;
    const tCompletedAt = m.task.completedAt ? sqlId(m.task.completedAt) : null;

    const trTaskId = sqlId(m.time.taskId);
    const trUserId = sqlId(m.time.userId);
    const trHours = sqlId(m.time.hours);
    const trTimeReportId = m.time.timeReportId ? sqlId(m.time.timeReportId) : null;
    const thId = m.timeReport?.id ? sqlId(m.timeReport.id) : null;
    const thWorkDate = m.timeReport?.workDate ? sqlId(m.timeReport.workDate) : null;

    if (!tOwner) {
      return Response.json(
        { error: 'task.ownerUserId is not mapped; please set ecp.columns.task.ownerUserId in config.json' },
        { status: 500 }
      );
    }

    const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';

    const usedSql =
      TH && trTimeReportId && thId && thWorkDate
        ? `
      SELECT
        tr.${trTaskId} AS task_id,
        tr.${trUserId} AS person_id,
        COALESCE(SUM(tr.${trHours}), 0) AS used_hours
      FROM ${TR} tr
      LEFT JOIN ${TH} th ON th.${thId} = tr.${trTimeReportId}
      WHERE th.${thWorkDate} >= ? AND th.${thWorkDate} < ?
      GROUP BY tr.${trTaskId}, tr.${trUserId}
    `
        : `
      SELECT
        tr.${trTaskId} AS task_id,
        tr.${trUserId} AS person_id,
        COALESCE(SUM(tr.${trHours}), 0) AS used_hours
      FROM ${TR} tr
      GROUP BY tr.${trTaskId}, tr.${trUserId}
    `;

    const sql = `
      SELECT
        ti.task_id,
        ti.task_name,
        ti.task_status,
        ti.received_at,
        ti.planned_hours,
        ti.planned_end_at,
        ti.completed_at,
        COALESCE(us.used_hours, 0) AS used_hours,
        (ti.planned_hours - COALESCE(us.used_hours, 0)) AS remaining_hours,
        ti.project_id,
        ${pCode ? `p.${pCode} AS project_code,` : `NULL AS project_code,`}
        p.${pName} AS project_name
      FROM (
        SELECT
          t.${tId} AS task_id,
          t.${tName} AS task_name,
          t.${tProjectId} AS project_id,
          ${tStatus ? `t.${tStatus} AS task_status,` : `NULL AS task_status,`}
          t.${tReceivedAt} AS received_at,
          ${tPlannedEndAt ? `t.${tPlannedEndAt} AS planned_end_at,` : `NULL AS planned_end_at,`}
          ${tCompletedAt ? `t.${tCompletedAt} AS completed_at,` : `NULL AS completed_at,`}
          ${plannedExpr} AS planned_hours
        FROM ${T} t
        WHERE t.${tOwner} = ?
          AND t.${tReceivedAt} >= ? AND t.${tReceivedAt} < ?
      ) ti
      LEFT JOIN (
        ${usedSql}
      ) us ON us.task_id = ti.task_id AND us.person_id = ?
      LEFT JOIN ${P} p ON p.${pId} = ti.project_id
      ORDER BY ti.received_at DESC, ti.task_id DESC
    `;

    const args: any[] = [personId, month.start, month.end];
    if (usedSql.includes('WHERE th.')) args.push(month.start, month.end);
    args.push(personId);

    const tasks = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // normalize numeric fields for JSON safety (SUM/expressions may come back as BigInt/Decimal)
    const normalized = tasks.map((t) => ({
      ...t,
      planned_hours: Number(t.planned_hours || 0),
      used_hours: Number(t.used_hours || 0),
      remaining_hours: Number(t.remaining_hours || 0)
    }));

    return Response.json({
      personId,
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      received_at_column: { table: m.tables.task, column: receivedAtCol },
      tasks: normalized
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


