import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminAuthGuard } from './admin/admin-auth.guard';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { PrismaService } from './db/prisma.service';
import { MessengerController } from './messenger/messenger.controller';
import { MessengerService } from './messenger/messenger.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuotesService } from './quotes/quotes.service';

@Module({
  imports: [],
  controllers: [AppController, QuotesController, MessengerController, AdminController],
  providers: [
    AppService,
    PrismaService,
    QuotesService,
    MessengerService,
    AdminService,
    AdminAuthGuard,
  ],
})
export class AppModule {}
