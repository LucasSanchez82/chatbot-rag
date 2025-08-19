/*
  Warnings:

  - You are about to drop the column `model` on the `Cost` table. All the data in the column will be lost.
  - Added the required column `cost` to the `Cost` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Cost" DROP COLUMN "model",
ADD COLUMN     "cost" DECIMAL(20,15) NOT NULL;
