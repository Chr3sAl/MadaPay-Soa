import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MessengerService } from './messenger.service';

@Controller('webhook')
export class MessengerController {
  constructor(private readonly messengerService: MessengerService) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.messengerService.verifyWebhook(mode, token, challenge);
  }

  @Post()
  async handleWebhook(@Body() body: any) {
    return this.messengerService.handleWebhook(body);
  }

  @Post('agent/resolve')
  async resolveAgentWorkflow(
    @Body()
    body: {
      transactionId: string;
      transferIdVerified: boolean;
      amountVerified: boolean;
      payoutSent: boolean;
      result: 'SUCCESS' | 'FAILED';
      failureReason?: string;
    },
  ) {
    return this.messengerService.resolveAgentWorkflow(body);
  }
}
