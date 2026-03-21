import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockClientInstance = vi.hoisted(() => ({
  on: vi.fn(),
  login: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn(),
  channels: {
    fetch: vi.fn(),
  },
}));

vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return mockClientInstance;
  }),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
  },
}));

import { DiscordAdapter } from '../discord.js';
import { Client, GatewayIntentBits } from 'discord.js';
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

describe('DiscordAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['DISCORD_BOT_TOKEN'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('type', () => {
    it('has type "discord"', () => {
      const adapter = new DiscordAdapter(makeConfig());
      expect(adapter.type).toBe('discord');
    });
  });

  describe('start()', () => {
    it('skips start when DISCORD_BOT_TOKEN is not set', async () => {
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();

      expect(Client).not.toHaveBeenCalled();
    });

    it('creates Client with correct intents when token is set', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();

      expect(Client).toHaveBeenCalledWith({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });
    });

    it('subscribes to messageCreate and error events', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();

      const eventNames = mockClientInstance.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(eventNames).toContain('messageCreate');
      expect(eventNames).toContain('error');
    });

    it('logs in with the provided token', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();

      expect(mockClientInstance.login).toHaveBeenCalledWith('discord-test-token');
    });

    it('dispatches non-bot messages on messageCreate', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      // Find the messageCreate callback
      const messageCreateCall = mockClientInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'messageCreate',
      );
      const messageCreateCallback = messageCreateCall![1];

      const mockMessage = {
        author: { bot: false, id: 'user-123' },
        channelId: 'channel-456',
        content: 'hello discord',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        guildId: 'guild-789',
        reply: vi.fn(),
      };

      await messageCreateCallback(mockMessage);

      expect(handler).toHaveBeenCalledOnce();
      const dispatched = handler.mock.calls[0][0];
      expect(dispatched.channel).toBe('discord');
      expect(dispatched.channelId).toBe('channel-456');
      expect(dispatched.userId).toBe('user-123');
      expect(dispatched.content).toBe('hello discord');
      expect(dispatched.metadata).toEqual({ guildId: 'guild-789' });
    });

    it('filters bot messages on messageCreate', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const messageCreateCall = mockClientInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'messageCreate',
      );
      const messageCreateCallback = messageCreateCall![1];

      const botMessage = {
        author: { bot: true, id: 'bot-1' },
        channelId: 'ch-1',
        content: 'bot message',
        createdAt: new Date(),
        guildId: null,
        reply: vi.fn(),
      };

      await messageCreateCallback(botMessage);

      expect(handler).not.toHaveBeenCalled();
    });

    it('replyFn calls message.reply()', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const messageCreateCall = mockClientInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'messageCreate',
      );
      const messageCreateCallback = messageCreateCall![1];

      const mockReply = vi.fn();
      const mockMessage = {
        author: { bot: false, id: 'user-1' },
        channelId: 'ch-1',
        content: 'test',
        createdAt: new Date(),
        guildId: null,
        reply: mockReply,
      };

      await messageCreateCallback(mockMessage);

      const dispatched = handler.mock.calls[0][0];
      await dispatched.replyFn('reply text');

      expect(mockReply).toHaveBeenCalledWith('reply text');
    });

    it('sets guildId to undefined when null', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const messageCreateCall = mockClientInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'messageCreate',
      );
      const messageCreateCallback = messageCreateCall![1];

      const mockMessage = {
        author: { bot: false, id: 'user-1' },
        channelId: 'ch-1',
        content: 'test',
        createdAt: new Date(),
        guildId: null,
        reply: vi.fn(),
      };

      await messageCreateCallback(mockMessage);

      const dispatched = handler.mock.calls[0][0];
      expect(dispatched.metadata).toEqual({ guildId: undefined });
    });
  });

  describe('stop()', () => {
    it('destroys the client when started', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();
      await adapter.stop();

      expect(mockClientInstance.destroy).toHaveBeenCalled();
    });

    it('does nothing when client was not started', async () => {
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.stop();

      expect(mockClientInstance.destroy).not.toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('logs warning when client is not started', async () => {
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.send('ch-1', 'hello');

      const { logger } = await import('../../utils/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('fetches channel and sends message', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();

      const mockSend = vi.fn();
      const mockChannel = { isTextBased: () => true, send: mockSend };
      mockClientInstance.channels.fetch.mockResolvedValue(mockChannel);

      await adapter.send('ch-1', 'hello discord');

      expect(mockClientInstance.channels.fetch).toHaveBeenCalledWith('ch-1');
      expect(mockSend).toHaveBeenCalledWith('hello discord');
    });

    it('logs warning when channel is not found', async () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test-token';
      const adapter = new DiscordAdapter(makeConfig());
      await adapter.start();

      mockClientInstance.channels.fetch.mockResolvedValue(null);

      await adapter.send('ch-nonexist', 'hello');

      const { logger } = await import('../../utils/logger.js');
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
