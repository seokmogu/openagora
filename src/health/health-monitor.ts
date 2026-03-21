import type { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import type { HealthStatus } from '../types/index.js';
import { CircuitBreakerRegistry } from './circuit-breaker.js';

const START_TIME = Date.now();

export class HealthMonitor {
  private checks: Map<string, () => Promise<boolean>> = new Map();

  register(name: string, check: () => Promise<boolean>): void {
    this.checks.set(name, check);
    logger.debug('Health check registered', { name });
  }

  async check(): Promise<HealthStatus> {
    const results = await Promise.allSettled(
      Array.from(this.checks.entries()).map(async ([name, fn]) => {
        const ok = await fn();
        return { name, ok };
      }),
    );

    let healthy = true;
    for (const result of results) {
      if (result.status === 'rejected' || !result.value.ok) {
        healthy = false;
        const label =
          result.status === 'rejected' ? String(result.reason) : result.value.name;
        logger.warn('Health check failed', { check: label });
      }
    }

    const circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'> = {};
    for (const [name, breaker] of CircuitBreakerRegistry.getAll()) {
      circuitBreakers[name] = breaker.getState();
    }

    const status: HealthStatus = {
      healthy,
      uptime: Date.now() - START_TIME,
      activeProjects: 0,
      queueDepth: 0,
      circuitBreakers,
      lastCheck: new Date(),
    };

    logger.debug('Health check completed', { healthy, checks: this.checks.size });
    return status;
  }

  async httpHandler(_req: Request, res: Response): Promise<void> {
    try {
      const status = await this.check();
      const code = status.healthy ? 200 : 503;
      res.status(code).json(status);
    } catch (err) {
      logger.error('Health HTTP handler error', { err });
      res.status(500).json({ healthy: false, error: String(err) });
    }
  }
}
