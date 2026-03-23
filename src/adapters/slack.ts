import boltPkg from '@slack/bolt';
const { App } = boltPkg;
import { ChannelType, ChannelMessage } from '../types/index.js';
import { AppConfig } from '../config/loader.js';
import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class SlackAdapter extends BaseAdapter {
  readonly type: ChannelType = 'slack';
  private app?: InstanceType<typeof App>;
  private static instance?: SlackAdapter;

  constructor(config: AppConfig) {
    super(config);
    SlackAdapter.instance = this;
  }

  /** Add a reaction emoji to a message. */
  static async addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
    if (!SlackAdapter.instance?.app) return;
    try {
      await SlackAdapter.instance.app.client.reactions.add({
        channel,
        timestamp,
        name: emoji,
      });
    } catch (err) {
      logger.debug('SlackAdapter: failed to add reaction', { emoji, err });
    }
  }

  /** Remove a reaction emoji from a message. */
  static async removeReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
    if (!SlackAdapter.instance?.app) return;
    try {
      await SlackAdapter.instance.app.client.reactions.remove({
        channel,
        timestamp,
        name: emoji,
      });
    } catch (err) {
      logger.debug('SlackAdapter: failed to remove reaction', { emoji, err });
    }
  }

  async start(): Promise<void> {
    const botToken = process.env['SLACK_BOT_TOKEN'];
    const appToken = process.env['SLACK_APP_TOKEN'];

    if (!botToken || !appToken) {
      logger.warn('SlackAdapter: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set, skipping start');
      return;
    }

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    this.app.message(async ({ message, say }) => {
      try {
        // Skip bot messages
        if ('bot_id' in message && message.bot_id) return;
        if (message.type !== 'message') return;

        const msg = message as {
          text?: string;
          user?: string;
          channel: string;
          ts: string;
        };

        const content = msg.text ?? '';
        const userId = msg.user ?? 'unknown';
        const channelId = msg.channel;

        logger.info('SlackAdapter: message received', { channelId, userId, content });

        const channelMessage: ChannelMessage = {
          id: crypto.randomUUID(),
          channel: 'slack',
          channelId,
          userId,
          content,
          timestamp: new Date(),
          metadata: { ts: msg.ts, channelId: msg.channel },
          replyFn: async (text: string) => {
            await say({ text, thread_ts: msg.ts });
          },
        };

        await this.dispatch(channelMessage);
      } catch (err) {
        logger.error('SlackAdapter: error handling message', { err });
      }
    });

    await this.app.start();
    logger.info('SlackAdapter: started (Socket Mode)');
  }

  async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      logger.info('SlackAdapter: stopped');
    }
  }

  async send(channelId: string, message: string): Promise<void> {
    if (!this.app) {
      logger.warn('SlackAdapter: cannot send, app not started');
      return;
    }
    try {
      await this.app.client.chat.postMessage({ channel: channelId, text: message });
    } catch (err) {
      logger.error('SlackAdapter: error sending message', { channelId, err });
    }
  }
}
