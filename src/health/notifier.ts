import { logger } from '../utils/logger.js';

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotifyPayload {
  title: string;
  body: string;
  level: NotifyLevel;
  projectId?: string;
  agentId?: string;
  durationMs?: number;
}

/**
 * Notifier: sends proactive notifications via Slack webhook and/or Telegram Bot API.
 * Reads config from env vars — disabled gracefully if not set.
 */
export class Notifier {
  private readonly slackWebhook: string | undefined;
  private readonly telegramToken: string | undefined;
  private readonly telegramChatId: string | undefined;

  constructor() {
    this.slackWebhook = process.env['SLACK_NOTIFY_WEBHOOK'];
    this.telegramToken = process.env['TELEGRAM_BOT_TOKEN'];
    this.telegramChatId = process.env['TELEGRAM_NOTIFY_CHAT_ID'];
  }

  get isConfigured(): boolean {
    return !!(this.slackWebhook || (this.telegramToken && this.telegramChatId));
  }

  async send(payload: NotifyPayload): Promise<void> {
    const text = this.format(payload);
    const promises: Promise<void>[] = [];

    if (this.slackWebhook) promises.push(this.sendSlack(text));
    if (this.telegramToken && this.telegramChatId) promises.push(this.sendTelegram(text));

    if (promises.length === 0) return;

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn('Notifier: send failed', { err: String(r.reason) });
      }
    }
  }

  private format(p: NotifyPayload): string {
    const icon = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }[p.level];
    const parts = [`${icon} *${p.title}*`, p.body];
    if (p.projectId) parts.push(`Project: \`${p.projectId}\``);
    if (p.agentId) parts.push(`Agent: \`${p.agentId}\``);
    if (p.durationMs !== undefined) parts.push(`Duration: ${(p.durationMs / 1000).toFixed(1)}s`);
    return parts.join('\n');
  }

  private async sendSlack(text: string): Promise<void> {
    const res = await fetch(this.slackWebhook!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Slack webhook ${res.status}`);
    logger.info('Notifier: Slack sent');
  }

  private async sendTelegram(text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.telegramChatId,
        text,
        parse_mode: 'Markdown',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram API ${res.status}`);
    logger.info('Notifier: Telegram sent');
  }
}
