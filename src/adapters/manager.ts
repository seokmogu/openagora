import type { AppConfig } from '../config/loader.js';
import type { ProjectRouter } from '../router/project-router.js';
import { logger } from '../utils/logger.js';
import { BaseAdapter } from './base.js';
import { SlackAdapter } from './slack.js';
import { DiscordAdapter } from './discord.js';
import { TelegramAdapter } from './telegram.js';
import { WebhookAdapter } from './webhook.js';
import { CliAdapter } from './cli.js';

export class AdapterManager {
  private adapters: BaseAdapter[] = [];

  constructor(config: AppConfig, router: ProjectRouter) {
    if (process.env['SLACK_BOT_TOKEN']) {
      this.adapters.push(new SlackAdapter(config));
    }
    if (process.env['DISCORD_BOT_TOKEN']) {
      this.adapters.push(new DiscordAdapter(config));
    }
    if (process.env['TELEGRAM_BOT_TOKEN']) {
      this.adapters.push(new TelegramAdapter(config));
    }
    this.adapters.push(new WebhookAdapter(config));
    this.adapters.push(new CliAdapter(config));

    this.adapters.forEach((a) =>
      a.setHandler((msg) => router.handleMessage(msg)),
    );
  }

  async startAll(): Promise<void> {
    logger.info('AdapterManager: starting all adapters', {
      count: this.adapters.length,
      types: this.adapters.map((a) => a.type),
    });
    await Promise.all(
      this.adapters.map((a) =>
        a.start().catch((err) => {
          logger.error('AdapterManager: adapter failed to start', {
            type: a.type,
            err,
          });
        }),
      ),
    );
  }

  async stopAll(): Promise<void> {
    logger.info('AdapterManager: stopping all adapters');
    await Promise.all(
      this.adapters.map((a) =>
        a.stop().catch((err) => {
          logger.error('AdapterManager: adapter failed to stop', {
            type: a.type,
            err,
          });
        }),
      ),
    );
  }
}
