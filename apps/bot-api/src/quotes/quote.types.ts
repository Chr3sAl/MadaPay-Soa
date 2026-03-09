export type QuoteMode = 'MGA_TOTAL_INCLUDING_FEE' | 'CNY_TARGET_EXACT';

export interface CreateQuoteDto {
  mode: QuoteMode;
  amount: number;
}

export interface QuoteResponseDto {
  inputMode: QuoteMode;
  inputAmount: number;
  feeAmountMga: number;
  exchangeableMga: number;
  destinationAmountCny: number;
  appliedRate: number;
}