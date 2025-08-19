import { prisma } from "@/lib/prisma";

const main = async () => {
  const groups = await prisma.transactionGroup.findMany({
    include: {
      items: true,
    },
  });
  const groupCosts = groups.map((group) =>
    group.items.reduce((acc, item) => acc + item.cost.toNumber(), 0)
  );
  console.table(
    groupCosts.map((cost, index) => ({
      question: groups[index].user_question,
      cost: cost.toFixed(6),
    }))
  );

  const totalCost = groups.reduce(
    (acc, group) =>
      acc +
      group.items.reduce((itemAcc, item) => itemAcc + item.cost.toNumber(), 0),
    0
  );
  console.log(`Total number of operations: ${groups.length}`);
  console.log(`Total cost: ${totalCost}`);
  console.log(
    `Average cost per operation: ${(totalCost / groups.length).toFixed(6)}`
  );
};

main();
