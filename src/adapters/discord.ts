import { Client, GatewayIntentBits, Message } from 'discord.js';
import { ChannelType, ChannelMessage } from '../types/index.js';
import { AppConfig } from '../config/loader.js';
import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class DiscordAdapter extends BaseAdapter {
  readonly type: ChannelType = 'discord';
  private client?: Client;

  constructor(config: AppConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const token = process.env['DISCORD_BOT_TOKEN'];

    if (!token) {
      logger.warn('DiscordAdapter: DISCORD_BOT_TOKEN not set, skipping start');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on('messageCreate', async (message: Message) => {
      try {
        // Skip bot messages
        if (message.author.bot) return;

        const channelMessage: ChannelMessage = {
          id: crypto.randomUUID(),
          channel: 'discord',
          channelId: message.channelId,
          userId: message.author.id,
          content: message.content,
          timestamp: message.createdAt,
          metadata: { guildId: message.guildId ?? undefined },
          replyFn: async (text: string) => {
            await message.reply(text);
          },
        };

        logger.info('DiscordAdapter: message received', {
          channelId: message.channelId,
          userId: message.author.id,
          content: message.content,
        });

        await this.dispatch(channelMessage);
      } catch (err) {
        logger.error('DiscordAdapter: error handling message', { err });
      }
    });

    this.client.on('error', (err) => {
      logger.error('DiscordAdapter: client error', { err });
    });

    await this.client.login(token);
    logger.info('DiscordAdapter: started');
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      logger.info('DiscordAdapter: stopped');
    }
  }

  async send(channelId: string, message: string): Promise<void> {
    if (!this.client) {
      logger.warn('DiscordAdapter: cannot send, client not started');
      return;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased() && 'send' in channel) {
        await (channel as { send(text: string): Promise<unknown> }).send(message);
      } else {
        logger.warn('DiscordAdapter: channel not found or not sendable', { channelId });
      }
    } catch (err) {
      logger.error('DiscordAdapter: error sending message', { channelId, err });
    }
  }
}
