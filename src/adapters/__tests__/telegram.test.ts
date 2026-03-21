import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockBotInstance = vi.hoisted(() => ({
  on: vi.fn(),
  catch: vi.fn(),
  launch: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  telegram: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('telegraf', () => ({
  Telegraf: vi.fn().mockImplementation(function () {
    return mockBotInstance;
  }),
}));

import { TelegramAdapter } from '../telegram.js';
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

describe('TelegramAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['TELEGRAM_BOT_TOKEN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('type', () => {
    it('has type "telegram"', () => {
      const adapter = new TelegramAdapter(makeConfig());
      expect(adapter.type).toBe('telegram');
    });
  });

  describe('start()', () => {
    it('skips start without TELEGRAM_BOT_TOKEN', async () => {
      const adapter = new TelegramAdapter(makeConfig());
      await adapter.start();

      const { Telegraf } = await import('telegraf');
      expect(Telegraf).not.toHaveBeenCalled();
    });

    it('initializes Telegraf bot with token', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
      const adapter = new TelegramAdapter(makeConfig());
      await adapter.start();

      const { Telegraf } = await import('telegraf');
      expect(Telegraf).toHaveBeenCalledWith('test-token');
      expect(mockBotInstance.launch).toHaveBeenCalled();
    });

    it('dispatches incoming text messages', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
      const adapter = new TelegramAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      // Find the 'text' handler callback
      const textCall = mockBotInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'text',
      );
      expect(textCall).toBeDefined();

      const textCallback = textCall![1];
      const mockCtx = {
        message: {
          from: { id: 12345 },
          chat: { id: 67890 },
          text: 'hello telegram',
          date: Math.floor(Date.now() / 1000),
          message_id: 999,
        },
        reply: vi.fn(),
      };

      await textCallback(mockCtx);

      expect(handler).toHaveBeenCalledOnce();
      const dispatched = handler.mock.calls[0][0];
      expect(dispatched.channel).toBe('telegram');
      expect(dispatched.userId).toBe('12345');
      expect(dispatched.channelId).toBe('67890');
      expect(dispatched.content).toBe('hello telegram');
    });
  });

  describe('stop()', () => {
    it('stops the bot when started', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
      const adapter = new TelegramAdapter(makeConfig());
      await adapter.start();
      await adapter.stop();

      expect(mockBotInstance.stop).toHaveBeenCalledWith('SIGTERM');
    });

    it('does nothing when bot was not started', async () => {
      const adapter = new TelegramAdapter(makeConfig());
      await adapter.stop();
      expect(mockBotInstance.stop).not.toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('sends message via bot.telegram.sendMessage', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
      const adapter = new TelegramAdapter(makeConfig());
      await adapter.start();

      await adapter.send('chat-123', 'hello');

      expect(mockBotInstance.telegram.sendMessage).toHaveBeenCalledWith('chat-123', 'hello');
    });

    it('logs warning when bot not started', async () => {
      const adapter = new TelegramAdapter(makeConfig());
      await adapter.send('chat-123', 'hello');

      const { logger } = await import('../../utils/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
