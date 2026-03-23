import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './config/loader.js';
import { AdapterManager } from './adapters/manager.js';
import { ProjectRouter } from './router/project-router.js';
import { HealthDaemon } from './health/daemon.js';
import { logger } from './utils/logger.js';

function checkClaude(): boolean {
  try {
    execFileSync('claude', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function printBanner(channels: string): void {
  const lines = [
    '',
    '  OpenAgora v0.1.0',
    '  Multi-Agent Orchestration Platform',
    '',
    `  Channels: ${channels}`,
    `  Health:   http://localhost:${process.env['HEALTH_PORT'] ?? '3001'}/health`,
    '',
  ];
  for (const line of lines) {
    console.log(line);
  }
}

async function main(): Promise<void> {
  const config = await loadConfig();

  if (!checkClaude()) {
    logger.error('Claude CLI not found. Install from: https://docs.anthropic.com/en/docs/claude-code');
    console.error('\n  ERROR: Claude CLI not found on PATH.');
    console.error('  Install: https://docs.anthropic.com/en/docs/claude-code\n');
    process.exit(1);
  }

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

  const activeChannels = adapters.getActiveChannels();
  printBanner(activeChannels);
  logger.info('OpenAgora started', { version: '0.1.0', channels: activeChannels });

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
