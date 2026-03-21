import readline from 'node:readline';
import { ChannelType, ChannelMessage } from '../types/index.js';
import { AppConfig } from '../config/loader.js';
import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

export class CliAdapter extends BaseAdapter {
  readonly type: ChannelType = 'cli';
  private rl?: readline.Interface;

  constructor(config: AppConfig) {
    super(config);
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', async (line: string) => {
      const content = line.trim();
      if (!content) return;

      logger.info('CliAdapter: message received', { content });

      const channelMessage: ChannelMessage = {
        id: crypto.randomUUID(),
        channel: 'cli',
        channelId: 'cli',
        userId: 'cli-user',
        content,
        timestamp: new Date(),
        replyFn: async (text: string) => {
          process.stdout.write(text + '\n');
        },
      };

      try {
        await this.dispatch(channelMessage);
      } catch (err) {
        logger.error('CliAdapter: error dispatching message', { err });
      }
    });

    this.rl.on('error', (err) => {
      logger.error('CliAdapter: readline error', { err });
    });

    logger.info('CliAdapter: started (reading from stdin)');
  }

  async stop(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      logger.info('CliAdapter: stopped');
    }
  }

  async send(_channelId: string, message: string): Promise<void> {
    process.stdout.write(message + '\n');
  }
}
