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

        if (!senderId) continue;
        if (text) {
          await this.handleIncomingText(senderId, text);
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

    if (normalized === 'START') {
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

    if (normalized === 'FR' || normalized === 'FRANCAIS' || normalized === 'FRANÇAIS') {
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

  private async handleAmountInput(senderId: string, text: string, session: any) {
    const language = ((session.language as SupportedLanguage) || 'EN');
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
    const language = ((session.language as SupportedLanguage) || 'EN');

    const yesValues = ['YES', 'OUI', 'ENY', 'Y'];
    const noValues = ['NO', 'NON', 'TSIA', 'N'];

    if (yesValues.includes(normalized)) {
      await this.prisma.messengerSession.update({
        where: { messengerPsid: senderId },
        data: {
          step: 'WAITING_FOR_QR',
        },
      });

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

  private isExpired(expiresAt?: Date | null) {
    if (!expiresAt) return false;
    return new Date() > new Date(expiresAt);
  }

  private async sendLanguagePrompt(senderId: string) {
    await this.sendTextMessage(
      senderId,
      `Choose language / Choisissez la langue / Fidio ny fiteny:\n\nFR - Français\nMG - Malagasy\nEN - English`,
    );
  }

  private async sendQuoteMessage(senderId: string, language: SupportedLanguage, quote: any) {
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

    await this.sendTextMessage(senderId, messages[language]);
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
      | 'waiting_qr_text_only',
  ) {
    const messages: Record<SupportedLanguage, Record<string, string>> = {
      EN: {
        ask_amount: 'Please send the amount in Ariary. Example: 220000',
        invalid_amount: 'Please send a valid MGA amount. Example: 220000',
        confirm_help: 'Please reply YES to continue or NO to cancel.',
        ask_qr: 'Please send a valid Alipay or WeChat Pay QR code image.',
        expired: 'Your quote has expired. Please send a new amount in Ariary.',
        waiting_qr_text_only: 'Please upload a QR code image, not text.',
      },
      FR: {
        ask_amount: 'Veuillez envoyer le montant en Ariary. Exemple: 220000',
        invalid_amount: 'Veuillez envoyer un montant MGA valide. Exemple: 220000',
        confirm_help: 'Répondez OUI pour continuer ou NON pour annuler.',
        ask_qr: 'Veuillez envoyer une image valide du QR code Alipay ou WeChat Pay.',
        expired: 'Votre devis a expiré. Veuillez envoyer un nouveau montant en Ariary.',
        waiting_qr_text_only: 'Veuillez envoyer une image du QR code, pas un texte.',
      },
      MG: {
        ask_amount: 'Alefaso ny vola amin’ny Ariary. Ohatra: 220000',
        invalid_amount: 'Alefaso azafady ny vola MGA marina. Ohatra: 220000',
        confirm_help: 'Valio ENY raha hanohy na TSIA raha hanafoana.',
        ask_qr: 'Alefaso azafady ny sary QR code Alipay na WeChat Pay marina.',
        expired: 'Lany daty ny kajinao. Alefaso vola vaovao amin’ny Ariary.',
        waiting_qr_text_only: 'Alefaso sary QR code fa tsy soratra.',
      },
    };

    await this.sendTextMessage(senderId, messages[language][key]);
  }

  private async sendTextMessage(recipientId: string, text: string) {
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
            message: { text },
          }),
        },
      );
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }
}