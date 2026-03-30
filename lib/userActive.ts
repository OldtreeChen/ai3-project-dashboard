import { prisma } from '@/lib/prisma';
import { sqlId } from '@/lib/ecpSchema';

type Candidate = { key: string; kind: 'enabled' | 'disabled' | 'deleted' };

const CANDIDATES: Candidate[] = [
  // enabled-ish
  { key: 'FIsEnabled', kind: 'enabled' },
  { key: 'FIsEnable', kind: 'enabled' },
  { key: 'IsEnabled', kind: 'enabled' },
  { key: 'IsEnable', kind: 'enabled' },
  { key: 'Enabled', kind: 'enabled' },
  { key: 'Enable', kind: 'enabled' },
  { key: 'FEnable', kind: 'enabled' },
  { key: 'FEnabled', kind: 'enabled' },
  { key: 'FActive', kind: 'enabled' },
  { key: 'IsActive', kind: 'enabled' },
  { key: 'Active', kind: 'enabled' },

  // disabled-ish
  { key: 'FIsDisabled', kind: 'disabled' },
  { key: 'FDisabled', kind: 'disabled' },
  { key: 'IsDisabled', kind: 'disabled' },
  { key: 'Disabled', kind: 'disabled' },
  { key: 'FDisable', kind: 'disabled' },
  { key: 'Disable', kind: 'disabled' },

  // deleted-ish
  { key: 'FIsDeleted', kind: 'deleted' },
  { key: 'FDeleted', kind: 'deleted' },
  { key: 'IsDeleted', kind: 'deleted' },
  { key: 'Deleted', kind: 'deleted' },
  { key: 'FIsDel', kind: 'deleted' },
  { key: 'IsDel', kind: 'deleted' },
  { key: 'FDel', kind: 'deleted' },
  { key: 'Del', kind: 'deleted' }
];

function norm(s: string) {
  return String(s || '').toLowerCase();
}

async function listColumns(tableName: string): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `
      SELECT c.column_name
      FROM information_schema.columns c
      WHERE c.table_schema = DATABASE()
        AND c.table_name = ?
    `,
    tableName
  );
  return rows.map((r) => r.column_name);
}

export async function getUserActiveFilter(tableName: string, alias: string) {
  // Returns best-effort SQL snippet + args to filter out disabled/deleted users.
  // If no suitable column exists, returns empty filter.
  const cols = await listColumns(tableName);
  const set = new Map(cols.map((c) => [norm(c), c]));

  // try exact match first
  let picked: { column: string; kind: Candidate['kind'] } | null = null;
  for (const cand of CANDIDATES) {
    const hit = set.get(norm(cand.key));
    if (hit) {
      picked = { column: hit, kind: cand.kind };
      break;
    }
  }

  // then substring match
  if (!picked) {
    for (const cand of CANDIDATES) {
      const hit = cols.find((c) => norm(c).includes(norm(cand.key)));
      if (hit) {
        picked = { column: hit, kind: cand.kind };
        break;
      }
    }
  }

  if (!picked) return { where: '', args: [] as any[], column: null as string | null };

  const col = `${alias}.${sqlId(picked.column)}`;

  // Strict mode: only show explicitly enabled users (NULL = not active)
  if (picked.kind === 'enabled') {
    return {
      column: picked.column,
      where: ` AND ${col} IN (1,'1','Y','y','true','TRUE','T')`,
      args: [] as any[]
    };
  }

  // disabled/deleted columns: must be explicitly 0/false/N to be considered active
  return {
    column: picked.column,
    where: ` AND (${col} IS NULL OR ${col} IN (0,'0','N','n','false','FALSE','F'))`,
    args: [] as any[]
  };
}


