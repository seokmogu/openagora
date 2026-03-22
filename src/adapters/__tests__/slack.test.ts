import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockAppInstance = vi.hoisted(() => ({
  message: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  client: {
    chat: {
      postMessage: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('@slack/bolt', () => {
  const AppFn = vi.fn().mockImplementation(function () {
    return mockAppInstance;
  });
  return { App: AppFn, default: { App: AppFn } };
});

import { SlackAdapter } from '../slack.js';
import { App } from '@slack/bolt';
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

describe('SlackAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SLACK_BOT_TOKEN'];
    delete process.env['SLACK_APP_TOKEN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('type', () => {
    it('has type "slack"', () => {
      const adapter = new SlackAdapter(makeConfig());
      expect(adapter.type).toBe('slack');
    });
  });

  describe('start()', () => {
    it('skips start when SLACK_BOT_TOKEN is not set', async () => {
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      await adapter.start();

      expect(App).not.toHaveBeenCalled();
    });

    it('skips start when SLACK_APP_TOKEN is not set', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      const adapter = new SlackAdapter(makeConfig());
      await adapter.start();

      expect(App).not.toHaveBeenCalled();
    });

    it('initializes Slack App with correct config when both tokens set', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      await adapter.start();

      expect(App).toHaveBeenCalledWith({
        token: 'xoxb-test',
        appToken: 'xapp-test',
        socketMode: true,
      });
      expect(mockAppInstance.message).toHaveBeenCalledWith(expect.any(Function));
      expect(mockAppInstance.start).toHaveBeenCalled();
    });

    it('subscribes to message events and dispatches non-bot messages', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      // Get the message handler that was registered
      const messageCallback = mockAppInstance.message.mock.calls[0][0];

      const mockSay = vi.fn();
      const mockMessage = {
        type: 'message',
        text: 'hello world',
        user: 'U123',
        channel: 'C456',
        ts: '1234567890.123456',
      };

      await messageCallback({ message: mockMessage, say: mockSay });

      expect(handler).toHaveBeenCalledOnce();
      const dispatched = handler.mock.calls[0][0];
      expect(dispatched.channel).toBe('slack');
      expect(dispatched.channelId).toBe('C456');
      expect(dispatched.userId).toBe('U123');
      expect(dispatched.content).toBe('hello world');
    });

    it('filters out bot messages', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const messageCallback = mockAppInstance.message.mock.calls[0][0];

      const botMessage = {
        type: 'message',
        bot_id: 'B123',
        text: 'bot says hi',
        channel: 'C456',
        ts: '1234567890.123456',
      };

      await messageCallback({ message: botMessage, say: vi.fn() });

      expect(handler).not.toHaveBeenCalled();
    });

    it('filters out non-message types', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const messageCallback = mockAppInstance.message.mock.calls[0][0];

      await messageCallback({ message: { type: 'channel_join' }, say: vi.fn() });

      expect(handler).not.toHaveBeenCalled();
    });

    it('replyFn calls say() with thread_ts', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const messageCallback = mockAppInstance.message.mock.calls[0][0];
      const mockSay = vi.fn();
      const mockMessage = {
        type: 'message',
        text: 'test',
        user: 'U1',
        channel: 'C1',
        ts: '111.222',
      };

      await messageCallback({ message: mockMessage, say: mockSay });

      const dispatched = handler.mock.calls[0][0];
      await dispatched.replyFn('reply text');

      expect(mockSay).toHaveBeenCalledWith({ text: 'reply text', thread_ts: '111.222' });
    });
  });

  describe('stop()', () => {
    it('stops the Slack app when started', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      await adapter.start();
      await adapter.stop();

      expect(mockAppInstance.stop).toHaveBeenCalled();
    });

    it('does nothing when app was not started', async () => {
      const adapter = new SlackAdapter(makeConfig());
      await adapter.stop();

      expect(mockAppInstance.stop).not.toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('posts message via Slack client when app is started', async () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      process.env['SLACK_APP_TOKEN'] = 'xapp-test';
      const adapter = new SlackAdapter(makeConfig());
      await adapter.start();

      await adapter.send('C123', 'hello slack');

      expect(mockAppInstance.client.chat.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: 'hello slack',
      });
    });

    it('logs warning when app is not started', async () => {
      const adapter = new SlackAdapter(makeConfig());
      await adapter.send('C123', 'hello');

      const { logger } = await import('../../utils/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
