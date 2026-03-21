import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock HealthMonitor
const mockCheck = vi.fn().mockResolvedValue({ healthy: true, uptime: 100 });
const mockSetDeps = vi.fn();
const mockHttpHandler = vi.fn();
vi.mock('../health-monitor.js', () => ({
  HealthMonitor: class MockHealthMonitor {
    check = mockCheck;
    setDeps = mockSetDeps;
    httpHandler = mockHttpHandler;
  },
}));

// Mock ProcessWatcher
const mockPwStart = vi.fn();
const mockPwStop = vi.fn();
vi.mock('../process-watcher.js', () => ({
  ProcessWatcher: class MockProcessWatcher {
    start = mockPwStart;
    stop = mockPwStop;
    register = vi.fn();
    unregister = vi.fn();
  },
}));

// Mock Notifier
vi.mock('../notifier.js', () => ({
  Notifier: class MockNotifier {
    send = vi.fn();
    isConfigured = false;
  },
}));

// Mock TaskDiscovery -- needs constructor that accepts opts
const mockTdStart = vi.fn();
const mockTdStop = vi.fn();
vi.mock('../task-discovery.js', () => ({
  TaskDiscovery: class MockTaskDiscovery {
    start = mockTdStart;
    stop = mockTdStop;
    onDiscover: unknown;
    constructor(opts: { onDiscover: unknown }) {
      this.onDiscover = opts.onDiscover;
    }
  },
}));

// Mock express and http
const mockListen = vi.fn().mockImplementation(function listen(_port: number, cb: () => void) { cb(); });
const mockClose = vi.fn().mockImplementation(function close(cb: () => void) { cb(); });
const mockHttpServer = { listen: mockListen, close: mockClose };
const mockGet = vi.fn();
vi.mock('express', () => {
  function express() { return { get: mockGet }; }
  return { default: express };
});
vi.mock('node:http', () => ({
  default: { createServer: function createServer() { return mockHttpServer; } },
}));

import { HealthDaemon } from '../daemon.js';
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

describe('HealthDaemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('starts process watcher and task discovery', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();

      expect(mockPwStart).toHaveBeenCalled();
      expect(mockTdStart).toHaveBeenCalled();
    });

    it('runs initial health check on start', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();

      expect(mockCheck).toHaveBeenCalledOnce();
    });

    it('starts HTTP health server on configured port', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();

      expect(mockListen).toHaveBeenCalledWith(3001, expect.any(Function));
    });

    it('registers /health endpoint', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();

      expect(mockGet).toHaveBeenCalledWith('/health', expect.any(Function));
    });
  });

  describe('stop()', () => {
    it('stops process watcher and task discovery', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();
      await daemon.stop();

      expect(mockPwStop).toHaveBeenCalled();
      expect(mockTdStop).toHaveBeenCalled();
    });

    it('clears health check interval', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();

      mockCheck.mockClear();

      await daemon.stop();

      // Advance time past interval -- should NOT trigger another check
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);

      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('closes HTTP server', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();
      await daemon.stop();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('periodic health checks', () => {
    it('runs health check at configured interval', async () => {
      const daemon = new HealthDaemon(makeConfig());
      await daemon.start();

      expect(mockCheck).toHaveBeenCalledTimes(1);

      // Advance 10 minutes (HEALTH_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(mockCheck).toHaveBeenCalledTimes(2);
    });

    it('handles health check failure gracefully', async () => {
      mockCheck.mockRejectedValueOnce(new Error('check failed'));

      const daemon = new HealthDaemon(makeConfig());
      await expect(daemon.start()).resolves.toBeUndefined();
    });
  });

  describe('setRouter()', () => {
    it('sets deps on health monitor', () => {
      const daemon = new HealthDaemon(makeConfig());
      const mockRouter = {
        getActiveProjects: vi.fn().mockReturnValue([]),
        getQueueStats: vi.fn().mockReturnValue({}),
      };

      daemon.setRouter(mockRouter as unknown as import('../../router/project-router.js').ProjectRouter);

      expect(mockSetDeps).toHaveBeenCalledWith({
        getActiveProjects: expect.any(Function),
        getQueueStats: expect.any(Function),
      });
    });
  });

  describe('setDiscoveryCallback()', () => {
    it('replaces onDiscover function on task discovery', () => {
      const daemon = new HealthDaemon(makeConfig());
      const callback = vi.fn();
      daemon.setDiscoveryCallback(callback);

      const td = daemon.getTaskDiscovery();
      expect(td.onDiscover).toBe(callback);
    });
  });

  describe('getProcessWatcher()', () => {
    it('returns the process watcher instance', () => {
      const daemon = new HealthDaemon(makeConfig());
      const pw = daemon.getProcessWatcher();
      expect(pw).toBeDefined();
    });
  });

  describe('getNotifier()', () => {
    it('returns the notifier instance', () => {
      const daemon = new HealthDaemon(makeConfig());
      const n = daemon.getNotifier();
      expect(n).toBeDefined();
    });
  });
});
