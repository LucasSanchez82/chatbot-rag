import { prisma } from "@/lib/prisma";

const main = async () => {
  const costs = await prisma.transactionItem.findMany();
  console.table(costs);

  const totalCost = costs.reduce((acc, cost) => acc + cost.cost.toNumber(), 0);
  console.log(`Total number of operations: ${costs.length}`);
  console.log(`Total cost: ${totalCost}`);
  console.log(
    `Average cost per operation: ${(totalCost / costs.length).toFixed(6)}`
  );
};

main();
