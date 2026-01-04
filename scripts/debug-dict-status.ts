import { prisma } from "../lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    "SELECT FDictionaryId, FValue, FText FROM TsDictionaryItem WHERE FValue IN ('ExecuteBack','FinishBack','ExecuteAuditing','Assigned','Executing','Overdue','OverdueUpgrade') LIMIT 200"
  );
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
