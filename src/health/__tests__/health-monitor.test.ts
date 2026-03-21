import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../circuit-breaker.js', () => ({
  CircuitBreakerRegistry: {
    getAll: vi.fn().mockReturnValue(new Map()),
  },
}));

import { HealthMonitor } from '../health-monitor.js';

describe('HealthMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register()', () => {
    it('adds a health check', async () => {
      const monitor = new HealthMonitor();
      monitor.register('test-check', async () => true);

      const status = await monitor.check();
      expect(status.healthy).toBe(true);
    });
  });

  describe('check()', () => {
    it('returns healthy status when all checks pass', async () => {
      const monitor = new HealthMonitor();
      monitor.register('check1', async () => true);
      monitor.register('check2', async () => true);

      const status = await monitor.check();

      expect(status.healthy).toBe(true);
      expect(status).toHaveProperty('uptime');
      expect(status).toHaveProperty('lastCheck');
      expect(status.activeProjects).toBe(0);
      expect(status.queueDepth).toBe(0);
    });

    it('returns unhealthy when a check fails', async () => {
      const monitor = new HealthMonitor();
      monitor.register('good', async () => true);
      monitor.register('bad', async () => false);

      const status = await monitor.check();
      expect(status.healthy).toBe(false);
    });

    it('returns unhealthy when a check throws', async () => {
      const monitor = new HealthMonitor();
      monitor.register('throws', async () => {
        throw new Error('check failed');
      });

      const status = await monitor.check();
      expect(status.healthy).toBe(false);
    });

    it('uses deps for activeProjects and queueDepth', async () => {
      const monitor = new HealthMonitor();
      monitor.setDeps({
        getActiveProjects: () => ['proj-1', 'proj-2'],
        getQueueStats: () => ({
          q1: { size: 3, pending: 2 },
          q2: { size: 1, pending: 0 },
        }),
      });

      const status = await monitor.check();
      expect(status.activeProjects).toBe(2);
      expect(status.queueDepth).toBe(6);
    });
  });

  describe('httpHandler()', () => {
    it('returns 200 JSON when healthy', async () => {
      const monitor = new HealthMonitor();
      monitor.register('ok', async () => true);

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await monitor.httpHandler({} as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ healthy: true }),
      );
    });

    it('returns 503 JSON when unhealthy', async () => {
      const monitor = new HealthMonitor();
      monitor.register('bad', async () => false);

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await monitor.httpHandler({} as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ healthy: false }),
      );
    });

    it('returns 500 on error', async () => {
      const monitor = new HealthMonitor();
      // Override check to throw
      vi.spyOn(monitor, 'check').mockRejectedValue(new Error('boom'));

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await monitor.httpHandler({} as never, mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ healthy: false }),
      );
    });
  });
});
