import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './db/prisma.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';
import { MessengerController } from './messenger/messenger.controller';
import { MessengerService } from './messenger/messenger.service';

@Module({
  imports: [],
  controllers: [AppController, QuotesController, MessengerController],
  providers: [AppService, PrismaService, QuotesService, MessengerService],
})
export class AppModule {}
