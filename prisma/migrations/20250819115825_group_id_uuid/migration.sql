/*
  Warnings:

  - The primary key for the `TransactionGroup` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropForeignKey
ALTER TABLE "TransactionItem" DROP CONSTRAINT "TransactionItem_groupId_fkey";

-- AlterTable
ALTER TABLE "TransactionGroup" DROP CONSTRAINT "TransactionGroup_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "TransactionGroup_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "TransactionGroup_id_seq";

-- AlterTable
ALTER TABLE "TransactionItem" ALTER COLUMN "groupId" SET DATA TYPE TEXT;

-- AddForeignKey
ALTER TABLE "TransactionItem" ADD CONSTRAINT "TransactionItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TransactionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
