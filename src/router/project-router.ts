import type { AppConfig } from '../config/loader.js';
import type { ChannelMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class ProjectRouter {
  private readonly _config: AppConfig;

  constructor(config: AppConfig) {
    this._config = config;
  }

  async init(): Promise<void> {
    logger.info('Project router initialized', {
      registryPath: this._config.registry.projectsPath,
    });
  }

  async handleMessage(message: ChannelMessage): Promise<void> {
    logger.info('ProjectRouter: handling message', {
      id: message.id,
      channel: message.channel,
      channelId: message.channelId,
      userId: message.userId,
    });
    // Routing logic will be implemented here
  }
}
