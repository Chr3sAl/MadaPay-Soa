/*
  Warnings:

  - You are about to drop the column `fixedAmountMga` on the `FeeRule` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `FeeRule` table. All the data in the column will be lost.
  - Added the required column `channel` to the `FeeRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `feeAmountMga` to the `FeeRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxAmountMga` to the `FeeRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minAmountMga` to the `FeeRule` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FeeRule" DROP COLUMN "fixedAmountMga",
DROP COLUMN "name",
ADD COLUMN     "channel" TEXT NOT NULL,
ADD COLUMN     "feeAmountMga" INTEGER NOT NULL,
ADD COLUMN     "maxAmountMga" INTEGER NOT NULL,
ADD COLUMN     "minAmountMga" INTEGER NOT NULL;
