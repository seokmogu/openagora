import { createTransport } from 'nodemailer';
import type { AppConfig } from '../config/loader.js';
import type { ChannelMessage } from '../types/index.js';
import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

/**
 * EmailAdapter — polls IMAP for new emails, replies via SMTP.
 *
 * Required env vars:
 *   EMAIL_IMAP_HOST, EMAIL_IMAP_PORT, EMAIL_IMAP_USER, EMAIL_IMAP_PASS
 *   EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS
 *
 * Note: IMAP polling uses the `imapflow` package (add to package.json when enabling).
 * This adapter is disabled by default — enable by setting EMAIL_IMAP_HOST.
 */
export class EmailAdapter extends BaseAdapter {
  readonly type = 'email' as const;

  private pollInterval?: NodeJS.Timeout;
  private readonly pollMs = 60_000; // check every 60s

  constructor(config: AppConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const host = process.env['EMAIL_IMAP_HOST'];
    if (!host) {
      logger.info('EmailAdapter: EMAIL_IMAP_HOST not set, skipping');
      return;
    }

    logger.info('EmailAdapter: starting IMAP polling', { host, intervalMs: this.pollMs });
    this.pollInterval = setInterval(() => void this.pollInbox(), this.pollMs);
    await this.pollInbox(); // immediate first poll
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    logger.info('EmailAdapter: stopped');
  }

  async send(to: string, content: string): Promise<void> {
    const transport = createTransport({
      host: process.env['EMAIL_SMTP_HOST'],
      port: parseInt(process.env['EMAIL_SMTP_PORT'] ?? '587', 10),
      secure: false,
      auth: {
        user: process.env['EMAIL_SMTP_USER'],
        pass: process.env['EMAIL_SMTP_PASS'],
      },
    });

    await transport.sendMail({
      from: process.env['EMAIL_SMTP_USER'],
      to,
      subject: 'OpenAgora Response',
      text: content,
    });
  }

  private async pollInbox(): Promise<void> {
    try {
      // imapflow-based inbox polling
      // Requires: npm install imapflow
      const { ImapFlow } = await import('imapflow').catch(() => {
        throw new Error('imapflow not installed — run: npm install imapflow');
      });

      const client = new ImapFlow({
        host: process.env['EMAIL_IMAP_HOST'] ?? '',
        port: parseInt(process.env['EMAIL_IMAP_PORT'] ?? '993', 10),
        secure: true,
        auth: {
          user: process.env['EMAIL_IMAP_USER'] ?? '',
          pass: process.env['EMAIL_IMAP_PASS'] ?? '',
        },
        logger: false,
      });

      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        // Fetch unseen messages
        for await (const message of client.fetch('1:*', { envelope: true, bodyParts: ['TEXT'] })) {
          if (!message.envelope) continue;

          const from = message.envelope.from?.[0];
          if (!from?.address) continue;

          const subject = message.envelope.subject ?? '';
          const body = message.bodyParts?.get('TEXT')?.toString() ?? '';
          const content = `Subject: ${subject}\n\n${body}`.trim();
          const fromAddress = from.address;

          const channelMessage: ChannelMessage = {
            id: `email-${message.uid}`,
            channel: 'email' as ChannelMessage['channel'],
            channelId: 'inbox',
            userId: fromAddress,
            content,
            timestamp: message.envelope.date ?? new Date(),
            replyFn: async (reply: string) => {
              await this.send(fromAddress, reply);
            },
          };

          await this.dispatch(channelMessage);
        }
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (err) {
      logger.error('EmailAdapter: poll error', { err });
    }
  }
}
