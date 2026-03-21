import http from 'node:http';
import express from 'express';
import type { AppConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';
import { HealthMonitor } from './health-monitor.js';
import { ProcessWatcher } from './process-watcher.js';

const HEALTH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export class HealthDaemon {
  private monitor: HealthMonitor;
  private processWatcher: ProcessWatcher;
  private interval?: NodeJS.Timeout;
  private healthServer?: http.Server;

  constructor(private config: AppConfig) {
    this.monitor = new HealthMonitor();
    this.processWatcher = new ProcessWatcher();
  }

  async start(): Promise<void> {
    logger.info('Health daemon starting', {
      healthPort: this.config.health.port,
      intervalMs: HEALTH_INTERVAL_MS,
    });

    this.processWatcher.start();

    this.interval = setInterval(() => {
      void this.runCheck();
    }, HEALTH_INTERVAL_MS);

    this.startHealthServer();

    await this.runCheck();

    logger.info('Health daemon started');
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }

    this.processWatcher.stop();

    await new Promise<void>((resolve) => {
      if (this.healthServer) {
        this.healthServer.close(() => resolve());
      } else {
        resolve();
      }
    });

    logger.info('Health daemon stopped');
  }

  getProcessWatcher(): ProcessWatcher {
    return this.processWatcher;
  }

  private async runCheck(): Promise<void> {
    try {
      const status = await this.monitor.check();
      logger.info('Health check completed', {
        healthy: status.healthy,
        uptime: status.uptime,
      });
    } catch (err) {
      logger.error('Health check failed', { err });
    }
  }

  private startHealthServer(): void {
    const app = express();

    app.get('/health', (req, res) => {
      void this.monitor.httpHandler(req, res);
    });

    this.healthServer = http.createServer(app);
    this.healthServer.listen(this.config.health.port, () => {
      logger.info('Health HTTP server listening', { port: this.config.health.port });
    });
  }
}
