import { Body, Controller, Post } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import type { CreateQuoteDto } from './quote.types';

@Controller('quote')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post()
  async createQuote(@Body() body: CreateQuoteDto) {
    return this.quotesService.createQuote(body);
  }
}