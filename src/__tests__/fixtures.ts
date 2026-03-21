import type { ChannelMessage, QueuedTask, Project, DomainType } from '../types/index.js';

/** Create a ChannelMessage with sensible defaults. */
export function makeMessage(overrides?: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: 'msg-1',
    channel: 'cli',
    channelId: 'ch-1',
    userId: 'user-1',
    content: 'test message content',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    replyFn: async () => {},
    ...overrides,
  };
}

/** Create a QueuedTask with sensible defaults. */
export function makeQueuedTask(overrides?: Partial<QueuedTask>): QueuedTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    message: makeMessage(),
    priority: 0,
    enqueuedAt: new Date('2026-01-01T00:00:00Z'),
    status: 'pending',
    ...overrides,
  };
}

/** Create a Project with sensible defaults. */
export function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: 'proj-1',
    name: 'test-project',
    path: '/tmp/test-project',
    githubRepo: 'user/test-project',
    domain: 'development' as DomainType,
    agents: ['expert-developer'],
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Flush microtask queue to let pending promises settle. */
export function waitForEventLoop(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
