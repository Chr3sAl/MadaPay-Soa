-- CreateEnum
CREATE TYPE "BotLanguage" AS ENUM ('FR', 'MG', 'EN');

-- CreateEnum
CREATE TYPE "ConversationStep" AS ENUM ('CHOOSE_LANGUAGE', 'ENTER_AMOUNT', 'CONFIRM_QUOTE', 'WAITING_FOR_QR', 'HANDOFF_TO_AGENT', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionStatus" ADD VALUE 'WAITING_FOR_QR';
ALTER TYPE "TransactionStatus" ADD VALUE 'PENDING_HUMAN';
ALTER TYPE "TransactionStatus" ADD VALUE 'COMPLETED';

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_customerId_fkey";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "phone" TEXT,
ALTER COLUMN "messengerPsid" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ExchangeRate" ALTER COLUMN "startsAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "customerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MessengerSession" (
    "id" TEXT NOT NULL,
    "messengerPsid" TEXT NOT NULL,
    "language" "BotLanguage",
    "step" "ConversationStep" NOT NULL DEFAULT 'CHOOSE_LANGUAGE',
    "amountMga" DECIMAL(18,2),
    "feeAmountMga" DECIMAL(18,2),
    "cnyAmount" DECIMAL(18,2),
    "quoteRate" DECIMAL(18,6),
    "qrImageUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessengerSession_messengerPsid_key" ON "MessengerSession"("messengerPsid");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
