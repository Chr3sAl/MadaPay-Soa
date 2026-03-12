import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { CreateQuoteDto, QuoteResponseDto } from './quote.types';

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService) {}

  async createQuote(input: CreateQuoteDto): Promise<QuoteResponseDto> {
    const rate = await this.prisma.exchangeRate.findFirst({
      where: {
        from: 'MGA',
        to: 'CNY',
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!rate) {
      throw new NotFoundException('Active exchange rate not found');
    }

    if (input.mode === 'MGA_TOTAL_INCLUDING_FEE') {
      const feeRule = await this.prisma.feeRule.findFirst({
        where: {
          id: { startsWith: 'fee_other_' },
          channel: 'OTHER_OPERATORS',
          isActive: true,
          minAmountMga: { lte: Math.floor(input.amount) },
          maxAmountMga: { gte: Math.floor(input.amount) },
        },
      });

      if (!feeRule) {
        throw new NotFoundException('Matching fee rule not found');
      }

      const feeAmountMga = feeRule.feeAmountMga;
      const exchangeableMga = input.amount - feeAmountMga;
      const destinationAmountCny = Number(exchangeableMga) * Number(rate.rate);

      return {
        inputMode: input.mode,
        inputAmount: input.amount,
        feeAmountMga,
        exchangeableMga: Number(exchangeableMga.toFixed(2)),
        destinationAmountCny: Number(destinationAmountCny.toFixed(2)),
        appliedRate: Number(rate.rate),
      };
    }

    const targetCny = input.amount;
    const rawMgaNeeded = targetCny / Number(rate.rate);

    const feeRule = await this.prisma.feeRule.findFirst({
      where: {
        id: { startsWith: 'fee_other_' },
        channel: 'OTHER_OPERATORS',
        isActive: true,
        minAmountMga: { lte: Math.floor(rawMgaNeeded) },
        maxAmountMga: { gte: Math.floor(rawMgaNeeded) },
      },
    });

    if (!feeRule) {
      throw new NotFoundException('Matching fee rule not found');
    }

    const feeAmountMga = feeRule.feeAmountMga;
    const exchangeableMga = rawMgaNeeded;
    const destinationAmountCny = targetCny;

    return {
      inputMode: input.mode,
      inputAmount: input.amount,
      feeAmountMga,
      exchangeableMga: Number(exchangeableMga.toFixed(2)),
      destinationAmountCny: Number(destinationAmountCny.toFixed(2)),
      appliedRate: Number(rate.rate),
    };
  }
}
