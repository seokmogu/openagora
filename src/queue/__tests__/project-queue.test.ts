import { describe, it, expect, vi } from 'vitest';
import { ProjectQueue } from '../project-queue.js';
import type { ChannelMessage } from '../../types/index.js';

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

function makeMessage(id: string): ChannelMessage {
  return {
    id,
    channel: 'cli',
    channelId: 'ch-1',
    userId: 'user-1',
    content: `task ${id}`,
    timestamp: new Date(),
    replyFn: async () => {},
  };
}

describe('ProjectQueue', () => {
  it('enqueue runs the handler', async () => {
    const queue = new ProjectQueue();
    const handler = vi.fn().mockResolvedValue(undefined);

    await queue.enqueue('proj-1', makeMessage('msg-1'), handler);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('concurrency=1 per project: second task waits for first', async () => {
    const queue = new ProjectQueue();
    const order: number[] = [];

    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const first = queue.enqueue('proj-a', makeMessage('msg-a1'), async () => {
      order.push(1);
      await firstDone;
      order.push(2);
    });

    // Give the first task time to start
    await new Promise((r) => setTimeout(r, 10));

    const second = queue.enqueue('proj-a', makeMessage('msg-a2'), async () => {
      order.push(3);
    });

    // At this point, second has NOT started yet because concurrency=1
    expect(order).toEqual([1]);

    resolveFirst();
    await Promise.all([first, second]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('getDepth returns correct count', async () => {
    const queue = new ProjectQueue();
    let resolveTask!: () => void;
    const blocker = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    // Start a long-running task to occupy the queue
    const running = queue.enqueue('proj-d', makeMessage('msg-d1'), () => blocker);

    // Give the running task time to start
    await new Promise((r) => setTimeout(r, 10));

    // Enqueue a waiting task (depth = pending in queue)
    // The running task occupies 'pending=1', waiting task = 'size=1'
    const waiting = queue.enqueue('proj-d', makeMessage('msg-d2'), async () => {});

    await new Promise((r) => setTimeout(r, 10));

    const depth = queue.getDepth('proj-d');
    expect(depth).toBeGreaterThan(0);

    resolveTask();
    await Promise.all([running, waiting]);

    expect(queue.getDepth('proj-d')).toBe(0);
  });

  it('getStats returns queue stats', async () => {
    const queue = new ProjectQueue();
    await queue.enqueue('proj-s', makeMessage('msg-s1'), async () => {});

    const stats = queue.getStats();
    expect(stats['proj-s']).toBeDefined();
    expect(stats['proj-s']).toHaveProperty('size');
    expect(stats['proj-s']).toHaveProperty('pending');
  });

  it('different projects run in parallel', async () => {
    const queue = new ProjectQueue();
    const started: string[] = [];

    let resolveA!: () => void;
    let resolveB!: () => void;
    const doneA = new Promise<void>((r) => { resolveA = r; });
    const doneB = new Promise<void>((r) => { resolveB = r; });

    const taskA = queue.enqueue('proj-x', makeMessage('mx'), async () => {
      started.push('A');
      await doneA;
    });

    const taskB = queue.enqueue('proj-y', makeMessage('my'), async () => {
      started.push('B');
      await doneB;
    });

    // Both should start concurrently
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toContain('A');
    expect(started).toContain('B');

    resolveA();
    resolveB();
    await Promise.all([taskA, taskB]);
  });
});
