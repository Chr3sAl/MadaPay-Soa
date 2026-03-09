import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './db/prisma.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';

@Module({
  imports: [],
  controllers: [AppController, QuotesController],
  providers: [AppService, PrismaService, QuotesService],
})
export class AppModule {}
