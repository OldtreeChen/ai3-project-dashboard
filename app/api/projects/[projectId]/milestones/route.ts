import { prisma } from '@/lib/prisma';
import { sqlId } from '@/lib/ecpSchema';

export const dynamic = 'force-dynamic';

type MilestoneRow = {
  id: string | number;
  name: string;
  plan_date: string | null;
  actual_date: string | null;
  status: string | null;
  description: string | null;
  sort_order: number;
};

function pick(cols: string[], candidates: string[]): string | undefined {
  const lower = new Map(cols.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const hit = lower.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

async function findMilestoneTable(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN ('TcMilestone','TcProjectMilestone','TsMilestone')
       LIMIT 1`
    );
    return rows[0]?.table_name || null;
  } catch {
    return null;
  }
}

async function getColumns(tableName: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY ordinal_position`,
      tableName
    );
    return rows.map((r) => r.column_name);
  } catch {
    return [];
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await ctx.params;
    if (!projectId) return Response.json({ milestones: [] });

    const tableName = await findMilestoneTable();
    if (!tableName) return Response.json({ milestones: [] });

    const cols = await getColumns(tableName);
    if (!cols.length) return Response.json({ milestones: [] });

    const T = sqlId(tableName);
    const fId = pick(cols, ['FId', 'id', 'milestoneId', 'milestone_id']);
    const fName = pick(cols, ['FName', 'FTitle', 'name', 'title', 'milestoneName', 'milestone_name']);
    const fProjectId = pick(cols, ['FProjectId', 'projectId', 'project_id', 'prjId']);
    const fPlanDate = pick(cols, ['FPlanDate', 'FPlanEndDate', 'planDate', 'plan_date', 'plannedDate', 'planned_date']);
    const fActualDate = pick(cols, ['FActualDate', 'FCompleteDate', 'actualDate', 'actual_date', 'completedDate', 'completed_date']);
    const fStatus = pick(cols, ['FStatus', 'status', 'state']);
    const fDesc = pick(cols, ['FDescription', 'FRemark', 'description', 'remark', 'memo', 'note']);
    const fSort = pick(cols, ['FSequence', 'FSort', 'FOrder', 'sequence', 'sort', 'sort_order', 'orderNo', 'order_no']);

    if (!fId || !fName || !fProjectId) return Response.json({ milestones: [] });

    const sql = `
      SELECT
        m.${sqlId(fId)} AS id,
        m.${sqlId(fName)} AS name,
        ${fPlanDate ? `m.${sqlId(fPlanDate)} AS plan_date,` : 'NULL AS plan_date,'}
        ${fActualDate ? `m.${sqlId(fActualDate)} AS actual_date,` : 'NULL AS actual_date,'}
        ${fStatus ? `m.${sqlId(fStatus)} AS status,` : 'NULL AS status,'}
        ${fDesc ? `m.${sqlId(fDesc)} AS description,` : 'NULL AS description,'}
        ${fSort ? `m.${sqlId(fSort)} AS sort_order` : '0 AS sort_order'}
      FROM ${T} m
      WHERE m.${sqlId(fProjectId)} = ?
      ORDER BY ${fSort ? `m.${sqlId(fSort)} ASC,` : ''} m.${sqlId(fId)} ASC
      LIMIT 100
    `;

    const rows = await prisma.$queryRawUnsafe<MilestoneRow[]>(sql, projectId);
    const milestones = rows.map((r) => ({
      id: String(r.id),
      name: String(r.name || ''),
      plan_date: r.plan_date ? String(r.plan_date).slice(0, 10) : null,
      actual_date: r.actual_date ? String(r.actual_date).slice(0, 10) : null,
      status: r.status ? String(r.status) : null,
      description: r.description ? String(r.description) : null,
      sort_order: Number(r.sort_order ?? 0),
    }));

    return Response.json({ milestones });
  } catch (err: any) {
    const message = err?.message ? String(err.message) : 'unknown error';
    return Response.json({ ok: false, error: message, milestones: [] }, { status: 500 });
  }
}
