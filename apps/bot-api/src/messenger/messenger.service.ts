import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { QuotesService } from '../quotes/quotes.service';

type SupportedLanguage = 'FR' | 'MG' | 'EN';

@Injectable()
export class MessengerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotesService: QuotesService,
  ) {}

  verifyWebhook(mode: string, token: string, challenge: string) {
    const verifyToken = process.env.META_VERIFY_TOKEN || 'madapay_verify';

    if (mode === 'subscribe' && token === verifyToken) {
      return challenge;
    }

    throw new UnauthorizedException('Invalid verify token');
  }

  async handleWebhook(body: any) {
    if (body.object !== 'page') {
      return { status: 'IGNORED' };
    }

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const text = event.message?.text?.trim();
        const quickReplyPayload = event.message?.quick_reply?.payload?.trim();
        const attachments = event.message?.attachments || [];

        if (!senderId) continue;
        if (text || quickReplyPayload) {
          await this.handleIncomingText(senderId, quickReplyPayload || text);
          continue;
        }

        if (attachments.length > 0) {
          await this.handleIncomingAttachments(senderId, attachments);
        }
      }
    }

    return { status: 'EVENT_RECEIVED' };
  }

  private async handleIncomingText(senderId: string, text: string) {
    const normalized = text.trim().toUpperCase();

    let session = await this.prisma.messengerSession.findUnique({
      where: { messengerPsid: senderId },
    });

    if (!session) {
      await this.prisma.messengerSession.create({
        data: {
          messengerPsid: senderId,
          step: 'CHOOSE_LANGUAGE',
        },
      });

      await this.sendLanguagePrompt(senderId);
      return;
    }

    if (this.isExpired(session.expiresAt)) {
      await this.prisma.messengerSession.update({
        where: { messengerPsid: senderId },
        data: {
          step: 'ENTER_AMOUNT',
          amountMga: null,
          feeAmountMga: null,
          cnyAmount: null,
          quoteRate: null,
          expiresAt: null,
        },
      });

      await this.sendLocalizedMessage(
        senderId,
        (session.language as SupportedLanguage) || 'EN',
        'expired',
      );
      return;
    }

    const resetValues = ['START', 'RESET', 'RESTART'];
    if (resetValues.includes(normalized)) {
      await this.resetSession(senderId);
      await this.sendLanguagePrompt(senderId);
      return;
    }

    const greetingValues = [
      'HI',
      'HELLO',
      'HEY',
      'BONJOUR',
      'SALUT',
      'MANAO AHOANA',
    ];
    if (
      greetingValues.includes(normalized) &&
      (!session.language || session.step === 'CHOOSE_LANGUAGE')
    ) {
      await this.sendLanguagePrompt(senderId);
      return;
    }

    switch (session.step) {
      case 'CHOOSE_LANGUAGE':
        await this.handleLanguageSelection(senderId, normalized, session);
        return;

      case 'ENTER_AMOUNT':
        await this.handleAmountInput(senderId, text, session);
        return;

      case 'CONFIRM_QUOTE':
        await this.handleQuoteConfirmation(senderId, normalized, session);
        return;

      case 'WAITING_FOR_QR':
        await this.sendLocalizedMessage(
          senderId,
          (session.language as SupportedLanguage) || 'EN',
          'waiting_qr_text_only',
        );
        return;

      case 'HANDOFF_TO_AGENT':
        if (session.expiresAt) {
          await this.handleTransferIdInput(senderId, text, session);
          return;
        }

        await this.sendLocalizedMessage(
          senderId,
          (session.language as SupportedLanguage) || 'EN',
          'handoff_notice',
        );
        return;

      default:
        await this.sendLanguagePrompt(senderId);
    }
  }

  private async handleLanguageSelection(
    senderId: string,
    normalized: string,
    session: any,
  ) {
    let language: SupportedLanguage | null = null;

    if (
      normalized === 'FR' ||
      normalized === 'FRANCAIS' ||
      normalized === 'FRANÇAIS'
    ) {
      language = 'FR';
    } else if (normalized === 'MG' || normalized === 'MALAGASY') {
      language = 'MG';
    } else if (normalized === 'EN' || normalized === 'ENGLISH') {
      language = 'EN';
    }

    if (!language) {
      await this.sendLanguagePrompt(senderId);
      return;
    }

    await this.prisma.messengerSession.update({
      where: { messengerPsid: senderId },
      data: {
        language,
        step: 'ENTER_AMOUNT',
      },
    });

    await this.sendLocalizedMessage(senderId, language, 'ask_amount');
  }

  private async handleAmountInput(
    senderId: string,
    text: string,
    session: any,
  ) {
    const language = (session.language as SupportedLanguage) || 'EN';
    const amount = Number(text.replace(/[^0-9.]/g, ''));

    if (!amount || Number.isNaN(amount)) {
      await this.sendLocalizedMessage(senderId, language, 'invalid_amount');
      return;
    }

    const quote = await this.quotesService.createQuote({
      mode: 'MGA_TOTAL_INCLUDING_FEE',
      amount,
    });

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

    await this.prisma.messengerSession.update({
      where: { messengerPsid: senderId },
      data: {
        step: 'CONFIRM_QUOTE',
        amountMga: quote.inputAmount,
        feeAmountMga: quote.feeAmountMga,
        cnyAmount: quote.destinationAmountCny,
        quoteRate: quote.appliedRate,
        expiresAt,
      },
    });

    await this.sendQuoteMessage(senderId, language, quote);
  }

  private async handleQuoteConfirmation(
    senderId: string,
    normalized: string,
    session: any,
  ) {
    const language = (session.language as SupportedLanguage) || 'EN';

    const yesValues = ['YES', 'OUI', 'ENY', 'Y'];
    const noValues = ['NO', 'NON', 'TSIA', 'N'];

    if (yesValues.includes(normalized)) {
      await this.prisma.messengerSession.update({
        where: { messengerPsid: senderId },
        data: {
          step: 'WAITING_FOR_QR',
        },
      });

      await this.createOrUpdateAwaitingQrTransaction(senderId, session);
      await this.sendLocalizedMessage(senderId, language, 'ask_qr');
      return;
    }

    if (noValues.includes(normalized)) {
      await this.prisma.messengerSession.update({
        where: { messengerPsid: senderId },
        data: {
          step: 'ENTER_AMOUNT',
          amountMga: null,
          feeAmountMga: null,
          cnyAmount: null,
          quoteRate: null,
          expiresAt: null,
        },
      });

      await this.sendLocalizedMessage(senderId, language, 'ask_amount');
      return;
    }

    await this.sendLocalizedMessage(senderId, language, 'confirm_help');
  }

  private async handleIncomingAttachments(
    senderId: string,
    attachments: any[],
  ) {
    const session = await this.prisma.messengerSession.findUnique({
      where: { messengerPsid: senderId },
    });

    if (!session) {
      await this.sendLanguagePrompt(senderId);
      return;
    }

    const language = (session.language as SupportedLanguage) || 'EN';
    const imageAttachment = attachments.find(
      (attachment) => attachment?.type === 'image' && attachment?.payload?.url,
    );

    if (session.step === 'HANDOFF_TO_AGENT' && session.expiresAt) {
      await this.sendLocalizedMessage(
        senderId,
        language,
        'waiting_transfer_id_text_only',
      );
      return;
    }

    if (session.step !== 'WAITING_FOR_QR') {
      await this.sendLocalizedMessage(senderId, language, 'unexpected_image');
      return;
    }

    if (!imageAttachment) {
      await this.sendLocalizedMessage(senderId, language, 'invalid_qr');
      return;
    }

    const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

    await this.prisma.messengerSession.update({
      where: { messengerPsid: senderId },
      data: {
        qrImageUrl: imageAttachment.payload.url,
        step: 'HANDOFF_TO_AGENT',
        expiresAt,
      },
    });

    await this.markTransactionAwaitingTransferId(
      senderId,
      imageAttachment.payload.url,
    );

    await this.sendLocalizedMessage(senderId, language, 'transfer_number');
    await this.sendLocalizedMessage(senderId, language, 'ask_transfer_id');
  }

  private async handleTransferIdInput(
    senderId: string,
    text: string,
    session: any,
  ) {
    const language = (session.language as SupportedLanguage) || 'EN';
    const transferId = text.trim().replace(/\s+/g, '').toUpperCase();

    if (!/^[A-Z0-9-]{4,}$/.test(transferId)) {
      await this.sendLocalizedMessage(
        senderId,
        language,
        'invalid_transfer_id',
      );
      return;
    }

    await this.prisma.messengerSession.update({
      where: { messengerPsid: senderId },
      data: {
        expiresAt: null,
      },
    });

    await this.markTransactionReadyForHandoff(senderId, transferId);

    await this.sendLocalizedMessage(senderId, language, 'transfer_id_received');
    await this.sendLocalizedMessage(senderId, language, 'handoff_notice');
    await this.handoffToHumanAgent(senderId, transferId);
  }

  private async createOrUpdateAwaitingQrTransaction(
    senderId: string,
    session: any,
  ) {
    const customer = await this.ensureCustomer(senderId);

    const inputAmount = Number(session.amountMga || 0);
    const feeAmount = Number(session.feeAmountMga || 0);
    const destinationAmount = Number(session.cnyAmount || 0);
    const appliedRate = Number(session.quoteRate || 0);
    const exchangeableMga = Number((inputAmount - feeAmount).toFixed(2));

    const existing = await this.prisma.transaction.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: ['QUOTE_CONFIRMED', 'WAITING_FOR_QR', 'AWAITING_TRANSFER_ID'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await this.prisma.transaction.update({
        where: { id: existing.id },
        data: {
          status: 'WAITING_FOR_QR',
          confirmedAt: new Date(),
          expiresAt: session.expiresAt || null,
          inputAmount,
          exchangeableMga,
          feeAmountMga: feeAmount,
          totalToPayMga: inputAmount,
          destinationAmountCny: destinationAmount,
          appliedRate,
        },
      });
      return;
    }

    await this.prisma.transaction.create({
      data: {
        customerId: customer.id,
        quoteMode: 'MGA_TOTAL_INCLUDING_FEE',
        inputAmount,
        inputCurrency: 'MGA',
        exchangeableMga,
        feeAmountMga: feeAmount,
        totalToPayMga: inputAmount,
        destinationAmountCny: destinationAmount,
        appliedRate,
        status: 'WAITING_FOR_QR',
        confirmedAt: new Date(),
        expiresAt: session.expiresAt || null,
      },
    });
  }

  private async markTransactionAwaitingTransferId(
    senderId: string,
    qrImageUrl: string,
  ) {
    const customer = await this.ensureCustomer(senderId);

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: ['WAITING_FOR_QR', 'QUOTE_CONFIRMED'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!transaction) return;

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'AWAITING_TRANSFER_ID',
        qrImagePath: qrImageUrl,
      },
    });
  }

  private async markTransactionReadyForHandoff(
    senderId: string,
    transferId: string,
  ) {
    const customer = await this.ensureCustomer(senderId);

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: ['AWAITING_TRANSFER_ID', 'WAITING_FOR_QR'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!transaction) return;

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        transferId,
        status: 'READY_FOR_HANDOFF',
        handedOffAt: new Date(),
      },
    });
  }

  private async ensureCustomer(senderId: string) {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { messengerPsid: senderId },
    });

    if (existingCustomer) return existingCustomer;

    return this.prisma.customer.create({
      data: {
        messengerPsid: senderId,
      },
    });
  }

  private isExpired(expiresAt?: Date | null) {
    if (!expiresAt) return false;
    return new Date() > new Date(expiresAt);
  }

  private async sendLanguagePrompt(senderId: string) {
    await this.sendTextMessage(
      senderId,
      `Choose language / Choisissez la langue / Fidio ny fiteny:

FR - Français
MG - Malagasy
EN - English`,
      [
        { content_type: 'text', title: 'FR', payload: 'FR' },
        { content_type: 'text', title: 'MG', payload: 'MG' },
        { content_type: 'text', title: 'EN', payload: 'EN' },
        {
          content_type: 'text',
          title: 'Reset / Réinitialiser / Avereno',
          payload: 'START',
        },
      ],
    );
  }

  private async sendQuoteMessage(
    senderId: string,
    language: SupportedLanguage,
    quote: any,
  ) {
    const messages = {
      EN:
        `Quote Result:\n\n` +
        `Input MGA: ${quote.inputAmount}\n` +
        `Fee MGA: ${quote.feeAmountMga}\n` +
        `Total to Pay MGA: ${quote.inputAmount}\n` +
        `Equivalent CNY: ${quote.destinationAmountCny}\n` +
        `Rate: ${quote.appliedRate}\n\n` +
        `Reply YES to continue or NO to cancel.\n` +
        `This quote expires in 20 minutes.`,
      FR:
        `Résultat du devis:\n\n` +
        `Montant MGA: ${quote.inputAmount}\n` +
        `Frais MGA: ${quote.feeAmountMga}\n` +
        `Total à payer MGA: ${quote.inputAmount}\n` +
        `Équivalent CNY: ${quote.destinationAmountCny}\n` +
        `Taux: ${quote.appliedRate}\n\n` +
        `Répondez OUI pour continuer ou NON pour annuler.\n` +
        `Ce devis expire dans 20 minutes.`,
      MG:
        `Vokatry ny kajy:\n\n` +
        `Vola MGA: ${quote.inputAmount}\n` +
        `Saram-pandefasana MGA: ${quote.feeAmountMga}\n` +
        `Totaly aloa MGA: ${quote.inputAmount}\n` +
        `Mitovy amin'ny CNY: ${quote.destinationAmountCny}\n` +
        `Taha: ${quote.appliedRate}\n\n` +
        `Valio ENY raha hanohy na TSIA raha hanafoana.\n` +
        `Lany daty ao anatin'ny 20 minitra ity kajy ity.`,
    };

    await this.sendTextMessage(
      senderId,
      messages[language],
      this.getResetQuickReply(language),
    );
  }

  private async sendLocalizedMessage(
    senderId: string,
    language: SupportedLanguage,
    key:
      | 'ask_amount'
      | 'invalid_amount'
      | 'confirm_help'
      | 'ask_qr'
      | 'expired'
      | 'waiting_qr_text_only'
      | 'invalid_qr'
      | 'transfer_number'
      | 'ask_transfer_id'
      | 'invalid_transfer_id'
      | 'transfer_id_received'
      | 'waiting_transfer_id_text_only'
      | 'handoff_notice'
      | 'unexpected_image',
  ) {
    const mobileMoneyNumber =
      process.env.MOBILE_MONEY_NUMBER ||
      process.env.MM_TRANSFER_NUMBER ||
      '034 00 000 00';

    const messages: Record<SupportedLanguage, Record<string, string>> = {
      EN: {
        ask_amount: 'Please send the amount in Ariary. Example: 220000',
        invalid_amount: 'Please send a valid MGA amount. Example: 220000',
        confirm_help: 'Please reply YES to continue or NO to cancel.',
        ask_qr: 'Please send a valid Alipay or WeChat Pay QR code image.',
        expired: 'Your quote has expired. Please send a new amount in Ariary.',
        waiting_qr_text_only: 'Please upload a QR code image, not text.',
        invalid_qr:
          'I could not read that image. Please send a clear Alipay or WeChat Pay QR code.',
        transfer_number: `QR received ✅
Please transfer the funds to this Mobile Money number: ${mobileMoneyNumber}`,
        ask_transfer_id:
          'After payment, please send your Mobile Money transfer ID here (example: MM123456).',
        invalid_transfer_id:
          'Please send a valid transfer ID using letters/numbers only (minimum 4 characters).',
        transfer_id_received:
          'Transfer ID received ✅. Thank you! We are now connecting you to a human agent for final verification.',
        waiting_transfer_id_text_only:
          'Please send your transfer ID as text (not an image).',
        handoff_notice:
          'Your chat has been handed to a human agent. They will continue with you shortly.',
        unexpected_image:
          'Image received. Please follow the current step or send START to restart.',
      },
      FR: {
        ask_amount: 'Veuillez envoyer le montant en Ariary. Exemple: 220000',
        invalid_amount:
          'Veuillez envoyer un montant MGA valide. Exemple: 220000',
        confirm_help: 'Répondez OUI pour continuer ou NON pour annuler.',
        ask_qr:
          'Veuillez envoyer une image valide du QR code Alipay ou WeChat Pay.',
        expired:
          'Votre devis a expiré. Veuillez envoyer un nouveau montant en Ariary.',
        waiting_qr_text_only:
          'Veuillez envoyer une image du QR code, pas un texte.',
        invalid_qr:
          'Je ne peux pas lire cette image. Veuillez envoyer un QR code Alipay ou WeChat Pay clair.',
        transfer_number: `QR reçu ✅
Veuillez transférer les fonds vers ce numéro Mobile Money : ${mobileMoneyNumber}`,
        ask_transfer_id:
          'Après le paiement, veuillez envoyer votre ID de transfert Mobile Money ici (exemple : MM123456).',
        invalid_transfer_id:
          'Veuillez envoyer un ID de transfert valide avec lettres/chiffres uniquement (minimum 4 caractères).',
        transfer_id_received:
          'ID de transfert reçu ✅. Merci ! Nous vous connectons maintenant à un agent humain pour la vérification finale.',
        waiting_transfer_id_text_only:
          'Veuillez envoyer votre ID de transfert en texte (pas une image).',
        handoff_notice:
          'Votre conversation est transférée à un agent humain. Il vous répondra sous peu.',
        unexpected_image:
          "Image reçue. Veuillez suivre l'étape en cours ou envoyer START pour recommencer.",
      },
      MG: {
        ask_amount: 'Alefaso ny vola amin’ny Ariary. Ohatra: 220000',
        invalid_amount: 'Alefaso azafady ny vola MGA marina. Ohatra: 220000',
        confirm_help: 'Valio ENY raha hanohy na TSIA raha hanafoana.',
        ask_qr: 'Alefaso azafady ny sary QR code Alipay na WeChat Pay marina.',
        expired: 'Lany daty ny kajinao. Alefaso vola vaovao amin’ny Ariary.',
        waiting_qr_text_only: 'Alefaso sary QR code fa tsy soratra.',
        invalid_qr:
          'Tsy voavaky ilay sary. Alefaso azafady QR code Alipay na WeChat Pay mazava.',
        transfer_number: `Voaray ny QR ✅
Alefaso amin'ity laharana Mobile Money ity ny vola: ${mobileMoneyNumber}`,
        ask_transfer_id:
          'Rehefa avy mandoa dia alefaso eto ny ID transfert Mobile Money (ohatra: MM123456).',
        invalid_transfer_id:
          'Alefaso azafady ID transfert marina misy litera/isa ihany (farafahakeliny 4 tarehintsoratra).',
        transfer_id_received:
          "Voaray ny ID transfert ✅. Misaotra! Ampifandraisinay amin'ny mpiasa tena izy ianao ho an'ny fanamarinana farany.",
        waiting_transfer_id_text_only:
          "Alefaso amin'ny soratra ny ID transfert (fa tsy sary).",
        handoff_notice:
          "Nafindra amin'ny mpiasa tena izy ny resaka. Hamaly anao tsy ho ela izy.",
        unexpected_image:
          'Voaray ny sary. Araho azafady ny dingana ankehitriny na alefaso START hanombohana indray.',
      },
    };

    await this.sendTextMessage(
      senderId,
      messages[language][key],
      this.getResetQuickReply(language),
    );
  }

  private getResetQuickReply(language: SupportedLanguage) {
    const resetLabels: Record<SupportedLanguage, string> = {
      EN: 'Reset',
      FR: 'Réinitialiser',
      MG: 'Avereno',
    };

    return [
      {
        content_type: 'text' as const,
        title: resetLabels[language],
        payload: 'START',
      },
    ];
  }

  private async resetSession(senderId: string) {
    await this.prisma.messengerSession.update({
      where: { messengerPsid: senderId },
      data: {
        language: null,
        step: 'CHOOSE_LANGUAGE',
        amountMga: null,
        feeAmountMga: null,
        cnyAmount: null,
        quoteRate: null,
        expiresAt: null,
        qrImageUrl: null,
      },
    });
  }

  private async handoffToHumanAgent(recipientId: string, transferId?: string) {
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    const targetAppId = process.env.META_SECONDARY_RECEIVER_APP_ID;

    if (!token || !targetAppId) return;

    try {
      await fetch(
        `https://graph.facebook.com/v23.0/me/pass_thread_control?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            target_app_id: Number(targetAppId),
            metadata: transferId
              ? `handoff_after_transfer_id:${transferId}`
              : 'handoff_after_transfer_id',
          }),
        },
      );
    } catch (error) {
      console.error('Failed to handoff thread control:', error);
    }
  }

  private async sendTextMessage(
    recipientId: string,
    text: string,
    quickReplies?: Array<{
      content_type: 'text';
      title: string;
      payload: string;
    }>,
  ) {
    const token = process.env.META_PAGE_ACCESS_TOKEN;

    if (!token) return;

    try {
      await fetch(
        `https://graph.facebook.com/v23.0/me/messages?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: {
              text,
              ...(quickReplies ? { quick_replies: quickReplies } : {}),
            },
          }),
        },
      );
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }
}
