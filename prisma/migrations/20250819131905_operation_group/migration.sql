-- AlterTable
ALTER TABLE "TransactionGroup" ADD COLUMN     "operationId" INTEGER;

-- CreateTable
CREATE TABLE "TransactionGroupOperation" (
    "id" SERIAL NOT NULL,
    "operation" TEXT NOT NULL,

    CONSTRAINT "TransactionGroupOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionGroupOperation_operation_key" ON "TransactionGroupOperation"("operation");

-- AddForeignKey
ALTER TABLE "TransactionGroup" ADD CONSTRAINT "TransactionGroup_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "TransactionGroupOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
