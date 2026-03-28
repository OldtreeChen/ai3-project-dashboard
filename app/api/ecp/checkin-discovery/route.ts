import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Discover CheckIn (打卡) related tables and columns in the ECP database.
 * This helps identify the correct table/column names for integrating attendance data.
 */
export async function GET() {
  try {
    // 1. Search for CheckIn-related tables
    const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string; table_rows: number }>>(
      `SELECT t.table_name, t.table_rows
       FROM information_schema.tables t
       WHERE t.table_schema = DATABASE()
         AND (t.table_name LIKE '%CheckIn%'
           OR t.table_name LIKE '%checkin%'
           OR t.table_name LIKE '%Attendance%'
           OR t.table_name LIKE '%attendance%'
           OR t.table_name LIKE '%Clock%'
           OR t.table_name LIKE '%clock%'
           OR t.table_name LIKE '%SignIn%'
           OR t.table_name LIKE '%signin%')
       ORDER BY t.table_rows DESC`
    );

    if (!tables.length) {
      return Response.json({
        ok: false,
        message: 'No CheckIn/Attendance tables found in database',
        hint: 'Try checking all tables with: GET /api/ecp/checkin-discovery?all=1'
      });
    }

    // 2. For each found table, get its columns
    const result: Array<{
      table_name: string;
      row_count: number;
      columns: Array<{ name: string; type: string; comment: string | null }>;
      sample_rows?: any[];
    }> = [];

    for (const t of tables.slice(0, 5)) {
      const cols = await prisma.$queryRawUnsafe<Array<{
        column_name: string;
        data_type: string;
        column_comment: string | null;
      }>>(
        `SELECT c.column_name, c.data_type,
                NULLIF(c.column_comment, '') AS column_comment
         FROM information_schema.columns c
         WHERE c.table_schema = DATABASE()
           AND c.table_name = ?
         ORDER BY c.ordinal_position ASC`,
        t.table_name
      );

      // Get a few sample rows to understand the data
      let sampleRows: any[] = [];
      try {
        sampleRows = await prisma.$queryRawUnsafe(
          `SELECT * FROM \`${t.table_name}\` ORDER BY 1 DESC LIMIT 5`
        );
        // Convert BigInt/Date to string for JSON serialization
        sampleRows = sampleRows.map((row: any) => {
          const obj: any = {};
          for (const [k, v] of Object.entries(row)) {
            if (typeof v === 'bigint') obj[k] = String(v);
            else if (v instanceof Date) obj[k] = v.toISOString();
            else obj[k] = v;
          }
          return obj;
        });
      } catch {
        // ignore if we can't read sample data
      }

      result.push({
        table_name: t.table_name,
        row_count: Number(t.table_rows),
        columns: cols.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          comment: c.column_comment
        })),
        sample_rows: sampleRows
      });
    }

    return Response.json({ ok: true, tables: result });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ? String(err.message) : 'unknown error' },
      { status: 500 }
    );
  }
}
