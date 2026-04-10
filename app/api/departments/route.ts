import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export const dynamic = 'force-dynamic';

// If ALLOWED_DEPTS is set (e.g. "技術服務部,雲端服務部"), only those departments are returned.
// If not set, defaults to AI專案一部 / AI專案二部.
const ALLOWED_DEPTS: string[] = process.env.ALLOWED_DEPTS
  ? process.env.ALLOWED_DEPTS.split(',').map((d) => d.trim()).filter(Boolean)
  : ['AI專案一部', 'AI專案二部'];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = url.searchParams.get('all') === '1';
  const m = await getEcpMapping();

  // Use department table if available
  if (m.tables.department && m.department) {
    const D = sqlId(m.tables.department);
    const dId = sqlId(m.department.id);
    const dName = sqlId(m.department.name);

    if (all && !process.env.ALLOWED_DEPTS) {
      // all=1 without scope restriction: return every department
      const sql = `
        SELECT DISTINCT
          d.${dId} AS id,
          d.${dName} AS name
        FROM ${D} d
        WHERE d.${dId} IS NOT NULL AND d.${dId} <> ''
        ORDER BY d.${dName} ASC
      `;
      const rows = await prisma.$queryRawUnsafe<any[]>(sql);
      return Response.json(rows);
    }

    // Build WHERE clause from ALLOWED_DEPTS — exact match only
    const inList = ALLOWED_DEPTS.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ');
    const sql = `
      SELECT DISTINCT
        d.${dId} AS id,
        d.${dName} AS name
      FROM ${D} d
      WHERE d.${dName} IN (${inList})
      ORDER BY d.${dName} ASC
    `;
    const rows = await prisma.$queryRawUnsafe<any[]>(sql);
    return Response.json(rows);
  }

  // Fallback to User table if no department table (should not happen with updated schema)
  const U = sqlId(m.tables.user);
  const uDeptId = m.user.departmentId ? sqlId(m.user.departmentId) : null;
  // ... existing fallback code ...
  if (!uDeptId) return Response.json([]);
  
  // We can't easily filter by name if we don't have department name in User table.
  // But since we updated schema, we expect the block above to run.
  return Response.json([]); 
}



