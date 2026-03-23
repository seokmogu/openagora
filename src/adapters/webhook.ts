import express, { Request, Response } from 'express';
import { createServer, Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ChannelType, ChannelMessage } from '../types/index.js';
import { AppConfig } from '../config/loader.js';
import { BaseAdapter } from './base.js';
import { logger } from '../utils/logger.js';

interface WebhookBody {
  projectId?: string;
  content: string;
  userId?: string;
}

export class WebhookAdapter extends BaseAdapter {
  readonly type: ChannelType = 'webhook';
  private server?: Server;
  private pendingReplies = new Map<string, (reply: string) => void>();

  constructor(config: AppConfig) {
    super(config);
  }

  async start(): Promise<void> {
    const port = parseInt(process.env['WEBHOOK_PORT'] ?? '3000', 10);
    const secret = process.env['WEBHOOK_SECRET'];

    if (!secret) {
      logger.warn('WebhookAdapter: WEBHOOK_SECRET not set, skipping start');
      return;
    }

    const app = express();
    app.use(express.json());

    app.post('/webhook', async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers['webhook-secret'] ?? req.headers['x-webhook-secret'];
        if (!authHeader || typeof authHeader !== 'string' ||
            authHeader.length !== secret.length ||
            !timingSafeEqual(Buffer.from(authHeader), Buffer.from(secret))) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const body = req.body as WebhookBody;
        if (!body.content) {
          res.status(400).json({ error: 'Missing content field' });
          return;
        }

        const msgId = crypto.randomUUID();
        const channelId = body.projectId ?? 'default';

        logger.info('WebhookAdapter: message received', {
          msgId,
          channelId,
          userId: body.userId ?? 'webhook-user',
        });

        const replyPromise = new Promise<string>((resolve) => {
          this.pendingReplies.set(msgId, resolve);
        });

        const channelMessage: ChannelMessage = {
          id: msgId,
          channel: 'webhook',
          channelId,
          userId: body.userId ?? 'webhook-user',
          content: body.content,
          timestamp: new Date(),
          metadata: { projectId: body.projectId },
          replyFn: async (text: string) => {
            const resolve = this.pendingReplies.get(msgId);
            if (resolve) {
              this.pendingReplies.delete(msgId);
              resolve(text);
            }
          },
        };

        await this.dispatch(channelMessage);

        // Wait up to 30s for a reply
        const reply = await Promise.race([
          replyPromise,
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 30_000),
          ),
        ]).catch(() => {
          this.pendingReplies.delete(msgId);
          return null;
        });

        if (reply !== null) {
          res.json({ reply });
        } else {
          res.json({ status: 'accepted' });
        }
      } catch (err) {
        logger.error('WebhookAdapter: error handling request', { err });
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    this.server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(port, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info('WebhookAdapter: started', { port });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      logger.info('WebhookAdapter: stopped');
    }
  }

  async send(_channelId: string, _message: string): Promise<void> {
    // Webhook adapter is request-response; outbound push is not applicable
    logger.warn('WebhookAdapter: send() is not supported for webhook channel');
  }
}
