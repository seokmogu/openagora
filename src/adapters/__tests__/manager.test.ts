import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Track mock adapter instances for assertions
const adapterInstances: Array<{ type: string; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; setHandler: ReturnType<typeof vi.fn> }> = [];

function createMockAdapterClass(type: string) {
  return class MockAdapter {
    type = type;
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    setHandler = vi.fn();
    constructor() { adapterInstances.push(this as unknown as (typeof adapterInstances)[number]); }
  };
}

vi.mock('../slack.js', () => ({ SlackAdapter: createMockAdapterClass('slack') }));
vi.mock('../discord.js', () => ({ DiscordAdapter: createMockAdapterClass('discord') }));
vi.mock('../telegram.js', () => ({ TelegramAdapter: createMockAdapterClass('telegram') }));
vi.mock('../webhook.js', () => ({ WebhookAdapter: createMockAdapterClass('webhook') }));
vi.mock('../cli.js', () => ({ CliAdapter: createMockAdapterClass('cli') }));
vi.mock('../email.js', () => ({ EmailAdapter: createMockAdapterClass('email') }));

import { AdapterManager } from '../manager.js';
import type { AppConfig } from '../../config/loader.js';
import type { ProjectRouter } from '../../router/project-router.js';

function makeConfig(): AppConfig {
  return {
    channels: {},
    server: { port: 3000, host: '0.0.0.0' },
    queue: { concurrency: 1, maxRetries: 3, retryDelayMs: 5000 },
    health: { intervalMs: 30000, port: 3001 },
    registry: { projectsPath: '/tmp/projects.json', agentsPath: '/tmp/agents.json' },
  };
}

function makeRouter(): ProjectRouter {
  return { handleMessage: vi.fn() } as unknown as ProjectRouter;
}

/** Find adapter instance by type from tracked instances. */
function findAdapter(type: string) {
  return adapterInstances.find((a) => a.type === type);
}

describe('AdapterManager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    adapterInstances.length = 0;
    // Clear adapter-related env vars
    delete process.env['SLACK_BOT_TOKEN'];
    delete process.env['DISCORD_BOT_TOKEN'];
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['EMAIL_IMAP_HOST'];
    // Set WEBHOOK_SECRET so webhook adapter is created in tests
    process.env['WEBHOOK_SECRET'] = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('constructor', () => {
    it('always includes webhook and cli adapters', () => {
      new AdapterManager(makeConfig(), makeRouter());

      expect(findAdapter('webhook')).toBeDefined();
      expect(findAdapter('cli')).toBeDefined();
      expect(findAdapter('webhook')!.setHandler).toHaveBeenCalled();
      expect(findAdapter('cli')!.setHandler).toHaveBeenCalled();
    });

    it('includes slack adapter when SLACK_BOT_TOKEN is set', () => {
      process.env['SLACK_BOT_TOKEN'] = 'xoxb-test';
      new AdapterManager(makeConfig(), makeRouter());

      expect(findAdapter('slack')).toBeDefined();
      expect(findAdapter('slack')!.setHandler).toHaveBeenCalled();
    });

    it('includes discord adapter when DISCORD_BOT_TOKEN is set', () => {
      process.env['DISCORD_BOT_TOKEN'] = 'discord-test';
      new AdapterManager(makeConfig(), makeRouter());

      expect(findAdapter('discord')).toBeDefined();
      expect(findAdapter('discord')!.setHandler).toHaveBeenCalled();
    });

    it('includes telegram adapter when TELEGRAM_BOT_TOKEN is set', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'telegram-test';
      new AdapterManager(makeConfig(), makeRouter());

      expect(findAdapter('telegram')).toBeDefined();
      expect(findAdapter('telegram')!.setHandler).toHaveBeenCalled();
    });

    it('includes email adapter when EMAIL_IMAP_HOST is set', () => {
      process.env['EMAIL_IMAP_HOST'] = 'imap.test.com';
      new AdapterManager(makeConfig(), makeRouter());

      expect(findAdapter('email')).toBeDefined();
      expect(findAdapter('email')!.setHandler).toHaveBeenCalled();
    });

    it('sets message handler on each adapter pointing to router.handleMessage', () => {
      const router = makeRouter();
      new AdapterManager(makeConfig(), router);

      expect(findAdapter('webhook')!.setHandler).toHaveBeenCalledWith(expect.any(Function));
      expect(findAdapter('cli')!.setHandler).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('startAll()', () => {
    it('calls start() on all registered adapters', async () => {
      const manager = new AdapterManager(makeConfig(), makeRouter());
      await manager.startAll();

      expect(findAdapter('webhook')!.start).toHaveBeenCalled();
      expect(findAdapter('cli')!.start).toHaveBeenCalled();
    });

    it('continues starting other adapters when one fails', async () => {
      const manager = new AdapterManager(makeConfig(), makeRouter());
      // Make webhook start fail
      findAdapter('webhook')!.start.mockRejectedValueOnce(new Error('webhook fail'));

      // Should not throw
      await expect(manager.startAll()).resolves.toBeUndefined();

      // CLI adapter should still have been started
      expect(findAdapter('cli')!.start).toHaveBeenCalled();
    });
  });

  describe('stopAll()', () => {
    it('calls stop() on all registered adapters', async () => {
      const manager = new AdapterManager(makeConfig(), makeRouter());
      await manager.stopAll();

      expect(findAdapter('webhook')!.stop).toHaveBeenCalled();
      expect(findAdapter('cli')!.stop).toHaveBeenCalled();
    });

    it('continues stopping other adapters when one fails', async () => {
      const manager = new AdapterManager(makeConfig(), makeRouter());
      findAdapter('webhook')!.stop.mockRejectedValueOnce(new Error('webhook stop fail'));

      await expect(manager.stopAll()).resolves.toBeUndefined();

      expect(findAdapter('cli')!.stop).toHaveBeenCalled();
    });
  });
});
