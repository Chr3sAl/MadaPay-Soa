import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessengerService } from '../messenger/messenger.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminService } from './admin.service';

@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly messengerService: MessengerService,
  ) {}

  @Get('transactions')
  async listTransactions(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listTransactions({
      status,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('transactions/:id')
  async getTransactionById(@Param('id') id: string) {
    return this.adminService.getTransactionById(id);
  }

  @Post('transactions/:id/resolve')
  async resolveTransaction(
    @Param('id') transactionId: string,
    @Body()
    body: {
      transferIdVerified: boolean;
      amountVerified: boolean;
      payoutSent: boolean;
      result: 'SUCCESS' | 'FAILED';
      failureReason?: string;
    },
    @Headers('x-admin-user') adminUser?: string,
  ) {
    const result = await this.messengerService.resolveAgentWorkflow({
      transactionId,
      transferIdVerified: body.transferIdVerified,
      amountVerified: body.amountVerified,
      payoutSent: body.payoutSent,
      result: body.result,
      failureReason: body.failureReason,
    });

    await this.adminService.writeAuditLog({
      actor: adminUser || 'unknown-admin',
      action: body.result === 'SUCCESS' ? 'RESOLVE_SUCCESS' : 'RESOLVE_FAILED',
      transactionId,
      payload: body as Record<string, unknown>,
      result: result as Record<string, unknown>,
    });

    return result;
  }

  @Get('audit-logs')
  async getAuditLogs(@Query('limit') limit?: string) {
    return this.adminService.readAuditLogs(limit ? Number(limit) : 50);
  }
}
