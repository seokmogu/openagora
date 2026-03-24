import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockRlInstance = vi.hoisted(() => ({
  on: vi.fn(),
  close: vi.fn(),
}));

vi.mock('node:readline', () => ({
  default: {
    createInterface: vi.fn().mockReturnValue(mockRlInstance),
  },
}));

import { CliAdapter } from '../cli.js';
import type { AppConfig } from '../../config/loader.js';

function makeConfig(): AppConfig {
  return {
    channels: {},
    server: { port: 3000, host: '0.0.0.0' },
    queue: { concurrency: 1, maxRetries: 3, retryDelayMs: 5000 },
    health: { intervalMs: 30000, port: 3001 },
    registry: { projectsPath: '/tmp/projects.json', agentsPath: '/tmp/agents.json' },
  };
}

describe('CliAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('type', () => {
    it('has type "cli"', () => {
      const adapter = new CliAdapter(makeConfig());
      expect(adapter.type).toBe('cli');
    });
  });

  describe('start()', () => {
    it('creates readline interface', async () => {
      const adapter = new CliAdapter(makeConfig());
      await adapter.start();

      const readline = await import('node:readline');
      expect(readline.default.createInterface).toHaveBeenCalled();
    });

    it('subscribes to line and error events', async () => {
      const adapter = new CliAdapter(makeConfig());
      await adapter.start();

      const eventNames = mockRlInstance.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(eventNames).toContain('line');
      expect(eventNames).toContain('error');
    });

    it('dispatches non-empty messages from stdin', async () => {
      const adapter = new CliAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const lineCall = mockRlInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'line',
      );
      const lineCallback = lineCall![1];

      await lineCallback('hello cli');

      expect(handler).toHaveBeenCalledOnce();
      const dispatched = handler.mock.calls[0][0];
      expect(dispatched.channel).toBe('cli');
      expect(dispatched.channelId).toBe('cli');
      expect(dispatched.userId).toBe('cli-user');
      expect(dispatched.content).toBe('hello cli');
    });

    it('ignores empty lines', async () => {
      const adapter = new CliAdapter(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      adapter.setHandler(handler);
      await adapter.start();

      const lineCall = mockRlInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'line',
      );
      const lineCallback = lineCall![1];

      await lineCallback('   ');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('closes readline when started', async () => {
      const adapter = new CliAdapter(makeConfig());
      await adapter.start();
      await adapter.stop();

      expect(mockRlInstance.close).toHaveBeenCalled();
    });

    it('does nothing when not started', async () => {
      const adapter = new CliAdapter(makeConfig());
      await adapter.stop();

      expect(mockRlInstance.close).not.toHaveBeenCalled();
    });
  });

  describe('send()', () => {
    it('writes to stdout', async () => {
      const adapter = new CliAdapter(makeConfig());
      const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      await adapter.send('cli', 'hello output');

      expect(writeSpy).toHaveBeenCalledWith('hello output\n');
      writeSpy.mockRestore();
    });
  });
});
