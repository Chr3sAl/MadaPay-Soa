-- CreateEnum
CREATE TYPE "Language" AS ENUM ('en', 'fr', 'mg');

-- CreateEnum
CREATE TYPE "QuoteMode" AS ENUM ('MGA_TOTAL_INCLUDING_FEE', 'CNY_TARGET_EXACT');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('ALIPAY', 'WECHAT_PAY');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('QUOTE_CREATED', 'QUOTE_CONFIRMED', 'AWAITING_QR', 'AWAITING_TRANSFER_ID', 'READY_FOR_HANDOFF', 'AWAITING_HUMAN', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "messengerPsid" TEXT NOT NULL,
    "language" "Language",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fixedAmountMga" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "language" "Language",
    "quoteMode" "QuoteMode" NOT NULL,
    "inputAmount" DECIMAL(18,2) NOT NULL,
    "inputCurrency" TEXT NOT NULL,
    "exchangeableMga" DECIMAL(18,2) NOT NULL,
    "feeAmountMga" DECIMAL(18,2) NOT NULL,
    "totalToPayMga" DECIMAL(18,2) NOT NULL,
    "destinationAmountCny" DECIMAL(18,2) NOT NULL,
    "appliedRate" DECIMAL(18,6) NOT NULL,
    "payoutMethod" "PayoutMethod",
    "qrImagePath" TEXT,
    "transferId" TEXT,
    "receiptImagePath" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'QUOTE_CREATED',
    "failureReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "handedOffAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_messengerPsid_key" ON "Customer"("messengerPsid");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
