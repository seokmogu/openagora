import http from 'node:http';
import express from 'express';
import type { AppConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';
import { HealthMonitor } from './health-monitor.js';
import { ProcessWatcher } from './process-watcher.js';
import type { ProjectRouter } from '../router/project-router.js';
import { Notifier } from './notifier.js';
import { TaskDiscovery } from './task-discovery.js';
import type { DiscoveredTask } from './task-discovery.js';

const HEALTH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export class HealthDaemon {
  private monitor: HealthMonitor;
  private processWatcher: ProcessWatcher;
  private readonly notifier: Notifier;
  private readonly taskDiscovery: TaskDiscovery;
  private interval?: NodeJS.Timeout;
  private healthServer?: http.Server;

  constructor(private config: AppConfig) {
    this.monitor = new HealthMonitor();
    this.processWatcher = new ProcessWatcher();
    this.notifier = new Notifier();
    this.taskDiscovery = new TaskDiscovery({
      onDiscover: async (task) => {
        logger.info('TaskDiscovery: discovered task', { projectId: task.projectId, reason: task.reason });
        // Will be replaced via setDiscoveryCallback()
      },
    });
  }

  async start(): Promise<void> {
    logger.info('Health daemon starting', {
      healthPort: this.config.health.port,
      intervalMs: HEALTH_INTERVAL_MS,
    });

    this.processWatcher.start();
    this.taskDiscovery.start();

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
    this.taskDiscovery.stop();

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

  getNotifier(): Notifier {
    return this.notifier;
  }

  setRouter(router: ProjectRouter): void {
    this.monitor.setDeps({
      getActiveProjects: () => router.getActiveProjects(),
      getQueueStats: () => router.getQueueStats(),
    });
  }

  setDiscoveryCallback(fn: (task: DiscoveredTask) => Promise<void>): void {
    this.taskDiscovery.onDiscover = fn;
  }

  getTaskDiscovery(): TaskDiscovery {
    return this.taskDiscovery;
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
