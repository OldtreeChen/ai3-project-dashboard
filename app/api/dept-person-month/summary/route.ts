import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';
import { getTaskReceivedAtColumn } from '@/lib/taskReceivedAt';
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
    const personId = parseIdParam(url.searchParams.get('personId'));

    const m = await getEcpMapping();
    const receivedAtCol = await getTaskReceivedAtColumn();

    const P = sqlId(m.tables.project);
    const T = sqlId(m.tables.task);
    const TR = sqlId(m.tables.time);
    const U = sqlId(m.tables.user);

    const tId = sqlId(m.task.id);
    const tProjectId = sqlId(m.task.projectId);
    const tOwner = m.task.ownerUserId ? sqlId(m.task.ownerUserId) : null;
    const tPlanned = m.task.plannedHours ? sqlId(m.task.plannedHours) : null;
    const tReceivedAt = sqlId(receivedAtCol);

    const trTaskId = sqlId(m.time.taskId);
    const trUserId = sqlId(m.time.userId);
    const trHours = sqlId(m.time.hours);

    const uId = sqlId(m.user.id);
    const uName = sqlId(m.user.displayName);
    const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;

    if (!tOwner) {
      return Response.json(
        { error: 'task.ownerUserId is not mapped; please set ecp.columns.task.ownerUserId in config.json' },
        { status: 500 }
      );
    }

    const plannedExpr = tPlanned ? `COALESCE(t.${tPlanned}, 0)` : '0';

    const usedSql = `
      SELECT
        tr.${trTaskId} AS task_id,
        tr.${trUserId} AS person_id,
        COALESCE(SUM(tr.${trHours}), 0) AS used_hours
      FROM ${TR} tr
      GROUP BY tr.${trTaskId}, tr.${trUserId}
    `;

    let sql = `
      SELECT
        u.${uId} AS person_id,
        u.${uName} AS display_name
        ${uDeptId ? `,u.${uDeptId} AS department_id` : `,NULL AS department_id`},
        COUNT(1) AS task_count,
        COALESCE(SUM(ti.planned_hours), 0) AS received_total_hours,
        COALESCE(SUM(COALESCE(us.used_hours, 0)), 0) AS used_hours,
        COALESCE(SUM(ti.planned_hours - COALESCE(us.used_hours, 0)), 0) AS remaining_hours
      FROM (
        SELECT
          t.${tId} AS task_id,
          t.${tOwner} AS person_id,
          ${plannedExpr} AS planned_hours
        FROM ${T} t
        WHERE t.${tOwner} IS NOT NULL AND t.${tOwner} <> ''
          AND t.${tReceivedAt} >= ? AND t.${tReceivedAt} < ?
      ) ti
      JOIN ${U} u ON u.${uId} = ti.person_id
      LEFT JOIN (
        ${usedSql}
      ) us ON us.task_id = ti.task_id AND us.person_id = ti.person_id
      WHERE 1=1
    `;

    const args: Array<string> = [month.start, month.end];
    if (departmentId && uDeptId) {
      sql += ` AND u.${uDeptId} = ?`;
      args.push(departmentId);
    }
    if (personId) {
      sql += ` AND u.${uId} = ?`;
      args.push(personId);
    }

    sql += `
      GROUP BY u.${uId}
      ORDER BY remaining_hours DESC, received_total_hours DESC, u.${uName} ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...args);

    // keep unused vars referenced (avoid tree-shaking confusion) — also confirms table compiles
    void P;
    void tProjectId;

    return Response.json({
      month: `${String(month.yyyy)}-${String(month.mm).padStart(2, '0')}`,
      date_range: { from: month.start, to_exclusive: month.end },
      received_at_column: { table: m.tables.task, column: receivedAtCol },
      filters: { departmentId: departmentId || null, personId: personId || null },
      people: rows
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


