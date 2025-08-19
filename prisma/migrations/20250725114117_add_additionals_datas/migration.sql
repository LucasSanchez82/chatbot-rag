/*
  Warnings:

  - Added the required column `model` to the `Cost` table without a default value. This is not possible if the table is not empty.
  - Added the required column `operation` to the `Cost` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user_question` to the `Cost` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Cost" ADD COLUMN     "model" TEXT NOT NULL,
ADD COLUMN     "operation" TEXT NOT NULL,
ADD COLUMN     "user_question" TEXT NOT NULL;
