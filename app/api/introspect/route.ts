import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Row = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  column_key: string;
  column_comment: string | null;
  table_comment: string | null;
  ordinal_position: number;
};

function normalize(s: string) {
  return s.toLowerCase();
}

function scoreTable(tableName: string) {
  const t = normalize(tableName);
  const hits: string[] = [];
  const add = (k: string, w: number) => {
    if (t.includes(k)) {
      hits.push(k);
      return w;
    }
    return 0;
  };
  // 粗略權重：越接近需求越高
  return {
    score:
      add('project', 30) +
      add('proj', 18) +
      add('prj', 18) +
      add('task', 26) +
      add('workitem', 22) +
      add('issue', 18) +
      add('ticket', 18) +
      add('time', 24) +
      add('hour', 24) +
      add('hours', 24) +
      add('timesheet', 30) +
      add('worklog', 26) +
      add('manhour', 30) +
      add('employee', 26) +
      add('emp', 18) +
      add('user', 14) +
      add('member', 14) +
      add('staff', 18) +
      add('people', 14),
    hits
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawQ = url.searchParams.get('q')?.trim();
  const q =
    rawQ && rawQ.length
      ? rawQ
      : 'project,proj,prj,task,issue,ticket,time,hour,hours,timesheet,worklog,manhour,employee,emp,user,member,staff,people';

  const tokens = q
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);

  // 組 where：table_name/column_name 任一命中
  const likeParts = tokens.map(() => `(LOWER(c.table_name) LIKE ? OR LOWER(c.column_name) LIKE ?)`).join(' OR ');
  const likeArgs: string[] = [];
  for (const t of tokens) {
    const pat = `%${t}%`;
    likeArgs.push(pat, pat);
  }

  const sql = `
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_key,
      NULLIF(c.column_comment, '') AS column_comment,
      NULLIF(t.table_comment, '') AS table_comment,
      c.ordinal_position
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = DATABASE()
      AND (${likeParts})
    ORDER BY c.table_name ASC, c.ordinal_position ASC
    LIMIT 5000
  `;

  const rows = await prisma.$queryRawUnsafe<Row[]>(sql, ...likeArgs);

  const byTable = new Map<
    string,
    {
      table_name: string;
      table_comment: string | null;
      score: number;
      hits: string[];
      columns: Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_key: string;
        column_comment: string | null;
        ordinal_position: number;
      }>;
    }
  >();

  for (const r of rows) {
    const key = r.table_name;
    if (!byTable.has(key)) {
      const s = scoreTable(key);
      byTable.set(key, {
        table_name: key,
        table_comment: r.table_comment,
        score: s.score,
        hits: s.hits,
        columns: []
      });
    }
    byTable.get(key)!.columns.push({
      column_name: r.column_name,
      data_type: r.data_type,
      is_nullable: r.is_nullable,
      column_key: r.column_key,
      column_comment: r.column_comment,
      ordinal_position: r.ordinal_position
    });
  }

  const tables = Array.from(byTable.values()).sort((a, b) => (b.score - a.score) || a.table_name.localeCompare(b.table_name));

  return Response.json({
    database: { schema: 'DATABASE()' },
    query: { q, tokens },
    tables
  });
}



