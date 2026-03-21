import { ChannelMessage, ChannelType } from '../types/index.js';
import { AppConfig } from '../config/loader.js';

export type MessageHandler = (message: ChannelMessage) => Promise<void>;

export abstract class BaseAdapter {
  abstract readonly type: ChannelType;
  protected handler?: MessageHandler;

  constructor(protected config: AppConfig) {}

  setHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(channelId: string, message: string): Promise<void>;

  protected async dispatch(message: ChannelMessage): Promise<void> {
    if (this.handler) await this.handler(message);
  }
}
