import { prisma } from '../lib/prisma';
import { getEcpMapping, sqlId } from '../lib/ecpSchema';

async function main() {
  const m = await getEcpMapping();
  const U = sqlId(m.tables.user);
  const uDeptName = m.user.departmentName ? sqlId(m.user.departmentName) : null;
  
  if (!uDeptName) {
    console.log('No department name column found');
    return;
  }
  
  const sql = `SELECT DISTINCT ${uDeptName} as name FROM ${U} ORDER BY name`;
  const rows = await prisma.$queryRawUnsafe(sql);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(e => console.error(e));
