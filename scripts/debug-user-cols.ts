import { prisma } from '../lib/prisma';
import { getEcpMapping, sqlId } from '../lib/ecpSchema';

async function main() {
  const m = await getEcpMapping();
  // list columns of User table
  const tableName = m.tables.user;
  const sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${tableName}'`;
  const rows = await prisma.$queryRawUnsafe(sql);
  console.log('User table columns:', JSON.stringify(rows, null, 2));

  // Also dump a few rows to see data
  const dumpSql = `SELECT * FROM ${sqlId(tableName)} LIMIT 3`;
  const data = await prisma.$queryRawUnsafe(dumpSql);
  console.log('User data sample:', JSON.stringify(data, null, 2));
}

main().catch(e => console.error(e));

