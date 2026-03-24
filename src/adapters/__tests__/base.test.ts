import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseAdapter } from '../base.js';
import type { ChannelMessage, ChannelType } from '../../types/index.js';
import type { AppConfig } from '../../config/loader.js';

/** Concrete subclass for testing the abstract BaseAdapter. */
class TestAdapter extends BaseAdapter {
  readonly type: ChannelType = 'cli';

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_channelId: string, _message: string): Promise<void> {}

  /** Expose protected dispatch for testing. */
  async testDispatch(message: ChannelMessage): Promise<void> {
    return this.dispatch(message);
  }
}

function makeConfig(): AppConfig {
  return {
    channels: {},
    server: { port: 3000, host: '0.0.0.0' },
    queue: { concurrency: 1, maxRetries: 3, retryDelayMs: 5000 },
    health: { intervalMs: 30000, port: 3001 },
    registry: { projectsPath: '/tmp/projects.json', agentsPath: '/tmp/agents.json' },
  };
}

function makeMessage(overrides?: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: 'msg-1',
    channel: 'cli',
    channelId: 'ch-1',
    userId: 'user-1',
    content: 'hello',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    replyFn: async () => {},
    ...overrides,
  };
}

describe('BaseAdapter', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TestAdapter(makeConfig());
  });

  describe('setHandler()', () => {
    it('registers a message handler', () => {
      const handler = vi.fn();
      adapter.setHandler(handler);

      // Handler is stored internally; verify via dispatch
      expect(() => adapter.setHandler(handler)).not.toThrow();
    });
  });

  describe('dispatch()', () => {
    it('calls the registered handler with the message', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);

      const msg = makeMessage();
      await adapter.testDispatch(msg);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(msg);
    });

    it('does nothing when no handler is registered', async () => {
      // Should not throw when dispatching without a handler
      await expect(adapter.testDispatch(makeMessage())).resolves.toBeUndefined();
    });

    it('propagates handler errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'));
      adapter.setHandler(handler);

      await expect(adapter.testDispatch(makeMessage())).rejects.toThrow('handler boom');
    });
  });

  describe('type property', () => {
    it('exposes the channel type', () => {
      expect(adapter.type).toBe('cli');
    });
  });
});
