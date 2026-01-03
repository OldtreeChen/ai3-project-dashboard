import { prisma } from '@/lib/prisma';
import { getEcpMapping, sqlId } from '@/lib/ecpSchema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const m = await getEcpMapping();
  
  // Use department table if available
  if (m.tables.department && m.department) {
    const D = sqlId(m.tables.department);
    const dId = sqlId(m.department.id);
    const dName = sqlId(m.department.name);
    
    const sql = `
      SELECT DISTINCT
        d.${dId} AS id,
        d.${dName} AS name
      FROM ${D} d
      WHERE d.${dName} LIKE '%專案一部%' OR d.${dName} LIKE '%專案二部%'
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



