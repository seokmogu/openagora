import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { logger } from '../utils/logger.js';

/** Channel adapter configuration. */
export interface ChannelConfig {
  enabled: boolean;
  token?: string;
  options?: Record<string, unknown>;
}

/** Full application configuration. */
export interface AppConfig {
  channels: Record<string, ChannelConfig>;
  server: {
    port: number;
    host: string;
  };
  queue: {
    concurrency: number;
    maxRetries: number;
    retryDelayMs: number;
  };
  health: {
    intervalMs: number;
    port: number;
  };
  registry: {
    projectsPath: string;
    agentsPath: string;
  };
}

const CONFIG_DIR = path.resolve(process.cwd(), 'config');

async function loadYamlFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseYaml(content) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(`Config file not found: ${filePath}`);
      return null;
    }
    throw err;
  }
}

const DEFAULT_CONFIG: AppConfig = {
  channels: {},
  server: {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
  },
  queue: {
    concurrency: 1,
    maxRetries: 3,
    retryDelayMs: 5000,
  },
  health: {
    intervalMs: 30_000,
    port: parseInt(process.env['HEALTH_PORT'] ?? '3001', 10),
  },
  registry: {
    projectsPath: path.resolve(process.cwd(), 'registry', 'projects.json'),
    agentsPath: path.resolve(process.cwd(), 'registry', 'agents.json'),
  },
};

export async function loadConfig(): Promise<AppConfig> {
  const channelsPath = path.join(CONFIG_DIR, 'channels.yaml');

  const channelsData = await loadYamlFile<Record<string, ChannelConfig>>(channelsPath);

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    channels: channelsData ?? DEFAULT_CONFIG.channels,
  };

  logger.info('Configuration loaded', {
    channelCount: Object.keys(config.channels).length,
  });

  const { existsSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  if (!existsSync(resolve(process.cwd(), '.env'))) {
    logger.info('No .env file found. Running with defaults (CLI mode). Run `openagora setup` to configure.');
  }

  return config;
}
