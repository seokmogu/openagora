import 'dotenv/config';

const HELP = `
Usage: openagora <command> [options]

Commands:
  start               Start the OpenAgora server
  setup               Run the interactive onboarding wizard
  status              Check server health status
  token list          List all configured tokens
  token add [adapter] Add or update a token interactively
  token remove <adapter>  Remove tokens for an adapter

Options:
  --help, help        Show this help message

Adapters: discord, slack, telegram, anthropic, github, webhook
`;

async function runStart(): Promise<void> {
  const { loadConfig } = await import('../config/loader.js');
  const { AdapterManager } = await import('../adapters/manager.js');
  const { ProjectRouter } = await import('../router/project-router.js');
  const { HealthDaemon } = await import('../health/daemon.js');
  const { logger } = await import('../utils/logger.js');

  const config = await loadConfig();
  const health = new HealthDaemon(config);
  const router = new ProjectRouter(config, health.getProcessWatcher());
  health.setRouter(router);
  router.setNotifier(health.getNotifier());
  health.setDiscoveryCallback((task) => router.handleDiscoveredTask(task));
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

async function runStatus(): Promise<void> {
  const port = process.env['HEALTH_PORT'] ?? '3001';
  const url = `http://localhost:${port}/health`;
  try {
    const res = await fetch(url);
    const body = (await res.json()) as unknown;
    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(JSON.stringify(body, null, 2));
  } catch {
    console.error(`Could not connect to ${url}`);
    console.error('Is the server running? Try: openagora start');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === 'help') {
    console.log(HELP);
    return;
  }

  if (cmd === 'start') {
    await runStart();
    return;
  }

  if (cmd === 'setup') {
    const { runSetup } = await import('./setup.js');
    await runSetup();
    return;
  }

  if (cmd === 'status') {
    await runStatus();
    return;
  }

  if (cmd === 'token') {
    const sub = args[1];
    const { listTokens, addToken, removeToken } = await import('./tokens.js');

    if (!sub || sub === 'list') {
      listTokens();
      return;
    }

    if (sub === 'add') {
      await addToken(args[2]);
      return;
    }

    if (sub === 'remove') {
      if (!args[2]) {
        console.error('Usage: openagora token remove <adapter>');
        process.exit(1);
      }
      removeToken(args[2]);
      return;
    }

    console.error(`Unknown token subcommand: ${sub}`);
    console.error('Available: list, add, remove');
    process.exit(1);
  }

  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
