import 'dotenv/config';
import { loadConfig } from './config/loader.js';
import { AdapterManager } from './adapters/manager.js';
import { ProjectRouter } from './router/project-router.js';
import { HealthDaemon } from './health/daemon.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  // HealthDaemon owns ProcessWatcher — init first so router can use it
  const health = new HealthDaemon(config);
  const router = new ProjectRouter(config, health.getProcessWatcher());
  health.setRouter(router);
  router.setNotifier(health.getNotifier());
  health.setDiscoveryCallback(task => router.handleDiscoveredTask(task));
  const adapters = new AdapterManager(config, router);

  await router.init();
  await adapters.startAll();
  await health.start();

  logger.info('OpenAgora started', { version: '0.1.0' });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    await adapters.stopAll();
    await health.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error('Fatal error', { error: err });
  process.exit(1);
});
