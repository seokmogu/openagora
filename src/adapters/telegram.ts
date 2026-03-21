import { Telegraf, Context } from 'telegraf';
import { ChannelType, ChannelMessage } from '../types/index.js';
import { AppConfig } from '../config/loader.js';
import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class TelegramAdapter extends BaseAdapter {
  readonly type: ChannelType = 'telegram';
  private bot?: Telegraf<Context>;

  constructor(config: AppConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const token = process.env['TELEGRAM_BOT_TOKEN'];

    if (!token) {
      logger.warn('TelegramAdapter: TELEGRAM_BOT_TOKEN not set, skipping start');
      return;
    }

    this.bot = new Telegraf<Context>(token);

    this.bot.on('text', async (ctx) => {
      try {
        const msg = ctx.message;
        const userId = String(msg.from.id);
        const channelId = String(msg.chat.id);
        const content = msg.text;

        logger.info('TelegramAdapter: message received', { channelId, userId, content });

        const channelMessage: ChannelMessage = {
          id: crypto.randomUUID(),
          channel: 'telegram',
          channelId,
          userId,
          content,
          timestamp: new Date(msg.date * 1000),
          metadata: { messageId: msg.message_id },
          replyFn: async (text: string) => {
            await ctx.reply(text);
          },
        };

        await this.dispatch(channelMessage);
      } catch (err) {
        logger.error('TelegramAdapter: error handling message', { err });
      }
    });

    this.bot.catch((err) => {
      logger.error('TelegramAdapter: bot error', { err });
    });

    await this.bot.launch();
    logger.info('TelegramAdapter: started (long polling)');
  }

  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop('SIGTERM');
      logger.info('TelegramAdapter: stopped');
    }
  }

  async send(channelId: string, message: string): Promise<void> {
    if (!this.bot) {
      logger.warn('TelegramAdapter: cannot send, bot not started');
      return;
    }
    try {
      await this.bot.telegram.sendMessage(channelId, message);
    } catch (err) {
      logger.error('TelegramAdapter: error sending message', { channelId, err });
    }
  }
}
