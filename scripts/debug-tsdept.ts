import { prisma } from '../lib/prisma';
import { getEcpMapping, sqlId } from '../lib/ecpSchema';

async function main() {
  const tableName = 'TsDepartment';
  const sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${tableName}'`;
  const rows = await prisma.$queryRawUnsafe(sql);
  console.log('TsDepartment columns:', JSON.stringify(rows, null, 2));

  const dumpSql = `SELECT * FROM TsDepartment LIMIT 5`;
  const data = await prisma.$queryRawUnsafe(dumpSql);
  console.log('TsDepartment data:', JSON.stringify(data, null, 2));
}

main().catch(e => console.error(e));

