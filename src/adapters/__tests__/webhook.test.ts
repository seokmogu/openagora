import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock express and http
const mockJson = vi.fn();
const mockStatus = vi.fn(() => ({ json: mockJson }));
const mockRes = { json: vi.fn(), status: mockStatus };

const mockRoutes: Record<string, (req: unknown, res: typeof mockRes) => Promise<void>> = {};
const mockUse = vi.fn();
const mockPost = vi.fn((path: string, handler: (req: unknown, res: typeof mockRes) => Promise<void>) => {
  mockRoutes[path] = handler;
});
const mockExpressApp = { use: mockUse, post: mockPost };

vi.mock('express', () => {
  const expressFn = () => mockExpressApp;
  expressFn.json = () => 'json-middleware';
  return { default: expressFn };
});

const mockServerClose = vi.fn((cb: () => void) => cb());
const mockServerListen = vi.fn((_port: number, cb: (err?: Error) => void) => cb());
const mockServer = { close: mockServerClose, listen: mockServerListen };

vi.mock('node:http', () => ({
  createServer: vi.fn(() => mockServer),
}));

import { WebhookAdapter } from '../webhook.js';
import type { AppConfig } from '../../config/loader.js';

function makeConfig(): AppConfig {
  return {
    channels: {},
    models: {},
    server: { port: 3000, host: '0.0.0.0' },
    queue: { concurrency: 1, maxRetries: 3, retryDelayMs: 5000 },
    health: { intervalMs: 30000, port: 3001 },
    registry: { projectsPath: '/tmp/projects.json', agentsPath: '/tmp/agents.json' },
  };
}

describe('WebhookAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockJson.mockClear();
    mockStatus.mockClear();
    mockRes.json.mockClear();
    Object.keys(mockRoutes).forEach((k) => delete mockRoutes[k]);
    delete process.env['WEBHOOK_PORT'];
    delete process.env['WEBHOOK_SECRET'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('type', () => {
    it('has type "webhook"', () => {
      const adapter = new WebhookAdapter(makeConfig());
      expect(adapter.type).toBe('webhook');
    });
  });

  describe('start()', () => {
    it('skips start when WEBHOOK_SECRET is not set', async () => {
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.start();

      // Should not have created a server
      const { createServer } = await import('node:http');
      expect(createServer).not.toHaveBeenCalled();
    });

    it('starts express server when WEBHOOK_SECRET is set', async () => {
      process.env['WEBHOOK_SECRET'] = 'test-secret';
      process.env['WEBHOOK_PORT'] = '4000';
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.start();

      const { createServer } = await import('node:http');
      expect(createServer).toHaveBeenCalledWith(mockExpressApp);
      expect(mockServerListen).toHaveBeenCalledWith(4000, expect.any(Function));
    });

    it('uses default port 3000 when WEBHOOK_PORT is not set', async () => {
      process.env['WEBHOOK_SECRET'] = 'test-secret';
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.start();

      expect(mockServerListen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    it('registers POST /webhook route', async () => {
      process.env['WEBHOOK_SECRET'] = 'test-secret';
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.start();

      expect(mockPost).toHaveBeenCalledWith('/webhook', expect.any(Function));
    });
  });

  describe('POST /webhook handler', () => {
    let adapter: WebhookAdapter;

    beforeEach(async () => {
      process.env['WEBHOOK_SECRET'] = 'my-secret';
      adapter = new WebhookAdapter(makeConfig());
      await adapter.start();
    });

    it('returns 401 when secret header is missing', async () => {
      const handler = mockRoutes['/webhook'];
      const req = { headers: {}, body: { content: 'hello' } };
      await handler(req, mockRes as never);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 401 when secret header does not match', async () => {
      const handler = mockRoutes['/webhook'];
      const req = { headers: { 'x-webhook-secret': 'wrong-secret' }, body: { content: 'hello' } };
      await handler(req, mockRes as never);

      expect(mockStatus).toHaveBeenCalledWith(401);
    });

    it('returns 400 when content field is missing', async () => {
      const handler = mockRoutes['/webhook'];
      const req = { headers: { 'x-webhook-secret': 'my-secret' }, body: {} };
      await handler(req, mockRes as never);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({ error: 'Missing content field' });
    });

    it('accepts valid request and dispatches message', async () => {
      const dispatchHandler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(dispatchHandler);

      const handler = mockRoutes['/webhook'];
      const req = {
        headers: { 'x-webhook-secret': 'my-secret' },
        body: { content: 'hello world', userId: 'user-42', projectId: 'proj-1' },
      };

      // The handler will wait for reply or timeout; we need to handle the 30s timeout
      // by making dispatch call replyFn immediately
      dispatchHandler.mockImplementation(async (msg: { replyFn: (text: string) => Promise<void> }) => {
        await msg.replyFn('response text');
      });

      await handler(req, mockRes as never);

      expect(dispatchHandler).toHaveBeenCalledOnce();
      expect(mockRes.json).toHaveBeenCalledWith({ reply: 'response text' });
    });

    it('accepts webhook-secret header (without x- prefix)', async () => {
      const dispatchHandler = vi.fn().mockImplementation(async (msg: { replyFn: (text: string) => Promise<void> }) => {
        await msg.replyFn('ok');
      });
      adapter.setHandler(dispatchHandler);

      const handler = mockRoutes['/webhook'];
      const req = {
        headers: { 'webhook-secret': 'my-secret' },
        body: { content: 'test' },
      };

      await handler(req, mockRes as never);
      expect(dispatchHandler).toHaveBeenCalledOnce();
    });
  });

  describe('stop()', () => {
    it('closes the server when started', async () => {
      process.env['WEBHOOK_SECRET'] = 'test-secret';
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.start();
      await adapter.stop();

      expect(mockServerClose).toHaveBeenCalled();
    });

    it('does nothing when server was not started', async () => {
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.stop();

      expect(mockServerClose).not.toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('logs a warning since webhook does not support outbound push', async () => {
      const adapter = new WebhookAdapter(makeConfig());
      await adapter.send('ch-1', 'hello');

      const { logger } = await import('../../utils/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
