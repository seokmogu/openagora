import PQueue from 'p-queue';
import type { QueuedTask, ChannelMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class ProjectQueue {
  private readonly queues = new Map<string, PQueue>();
  private readonly tasks = new Map<string, QueuedTask[]>();

  private getQueue(projectId: string): PQueue {
    if (!this.queues.has(projectId)) {
      this.queues.set(projectId, new PQueue({ concurrency: 1 }));
    }
    return this.queues.get(projectId)!;
  }

  async enqueue(
    projectId: string,
    message: ChannelMessage,
    handler: () => Promise<void>,
  ): Promise<void> {
    const queue = this.getQueue(projectId);

    const task: QueuedTask = {
      id: message.id,
      projectId,
      message,
      priority: 0,
      enqueuedAt: new Date(),
      status: 'pending',
    };

    const history = this.tasks.get(projectId) ?? [];
    history.push(task);
    this.tasks.set(projectId, history);

    logger.debug('Task enqueued', {
      projectId,
      taskId: task.id,
      queueSize: queue.size,
    });

    await queue.add(async () => {
      task.status = 'running';
      logger.info('Task started', { projectId, taskId: task.id });
      try {
        await handler();
        task.status = 'completed';
        logger.info('Task completed', { projectId, taskId: task.id });
      } catch (err) {
        task.status = 'failed';
        logger.error('Task failed', { projectId, taskId: task.id, error: err });
        throw err;
      }
    });
  }

  getDepth(projectId: string): number {
    const queue = this.queues.get(projectId);
    if (!queue) return 0;
    return queue.size + queue.pending;
  }

  getActiveProjects(): string[] {
    return Array.from(this.queues.keys()).filter((id) => {
      const q = this.queues.get(id)!;
      return q.size > 0 || q.pending > 0;
    });
  }

  getStats(): Record<string, { size: number; pending: number }> {
    const stats: Record<string, { size: number; pending: number }> = {};
    for (const [id, queue] of this.queues) {
      stats[id] = { size: queue.size, pending: queue.pending };
    }
    return stats;
  }
}
