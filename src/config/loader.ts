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

/** Model provider configuration. */
export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  capabilities: string[];
  options?: Record<string, unknown>;
}

/** Full application configuration. */
export interface AppConfig {
  channels: Record<string, ChannelConfig>;
  models: Record<string, ModelConfig>;
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
  models: {},
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
  const modelsPath = path.join(CONFIG_DIR, 'models.yaml');

  const [channelsData, modelsData] = await Promise.all([
    loadYamlFile<Record<string, ChannelConfig>>(channelsPath),
    loadYamlFile<Record<string, ModelConfig>>(modelsPath),
  ]);

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    channels: channelsData ?? DEFAULT_CONFIG.channels,
    models: modelsData ?? DEFAULT_CONFIG.models,
  };

  logger.info('Configuration loaded', {
    channelCount: Object.keys(config.channels).length,
    modelCount: Object.keys(config.models).length,
  });

  return config;
}
