import type { AppConfig } from '../config/loader.js';
import type { ProjectRouter } from '../router/project-router.js';
import { logger } from '../utils/logger.js';
import { BaseAdapter } from './base.js';
import { SlackAdapter } from './slack.js';
import { DiscordAdapter } from './discord.js';
import { TelegramAdapter } from './telegram.js';
import { WebhookAdapter } from './webhook.js';
import { CliAdapter } from './cli.js';
import { EmailAdapter } from './email.js';

export class AdapterManager {
  private adapters: BaseAdapter[] = [];

  constructor(config: AppConfig, router: ProjectRouter) {
    const active: string[] = [];
    const inactive: string[] = [];

    if (process.env['SLACK_BOT_TOKEN']) {
      this.adapters.push(new SlackAdapter(config));
      active.push('Slack');
    } else {
      inactive.push('Slack (no SLACK_BOT_TOKEN)');
    }
    if (process.env['DISCORD_BOT_TOKEN']) {
      this.adapters.push(new DiscordAdapter(config));
      active.push('Discord');
    } else {
      inactive.push('Discord (no DISCORD_BOT_TOKEN)');
    }
    if (process.env['TELEGRAM_BOT_TOKEN']) {
      this.adapters.push(new TelegramAdapter(config));
      active.push('Telegram');
    } else {
      inactive.push('Telegram (no TELEGRAM_BOT_TOKEN)');
    }
    if (process.env['EMAIL_IMAP_HOST']) {
      this.adapters.push(new EmailAdapter(config));
      active.push('Email');
    } else {
      inactive.push('Email (no EMAIL_IMAP_HOST)');
    }
    if (process.env['WEBHOOK_SECRET']) {
      this.adapters.push(new WebhookAdapter(config));
      active.push('Webhook');
    } else {
      inactive.push('Webhook (no WEBHOOK_SECRET)');
    }

    // CLI is always available
    this.adapters.push(new CliAdapter(config));
    active.push('CLI');

    this.adapters.forEach((a) =>
      a.setHandler((msg) => router.handleMessage(msg)),
    );

    logger.info('AdapterManager: channel detection complete', {
      active: active.join(', '),
      inactive: inactive.join(', '),
    });
  }

  getActiveChannels(): string {
    return this.adapters.map((a) => a.type).join(', ');
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
