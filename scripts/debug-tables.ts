import { prisma } from '../lib/prisma';

async function main() {
  const sql = `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`;
  const rows = await prisma.$queryRawUnsafe<{ TABLE_NAME: string }[]>(sql);
  // @ts-ignore
  const names = rows.map(r => r.TABLE_NAME || r.table_name).sort();
  console.log('Tables:', JSON.stringify(names, null, 2));
}

main().catch(e => console.error(e));

