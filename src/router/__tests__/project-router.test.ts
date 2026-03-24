import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Shared mock fns accessible in tests
const mockLoad = vi.fn().mockResolvedValue(undefined);
const mockMatchProject = vi.fn().mockResolvedValue(null);
const mockRegistryGet = vi.fn().mockResolvedValue(null);

vi.mock('../registry.js', () => ({
  ProjectRegistry: class MockProjectRegistry {
    load = mockLoad;
    matchProject = mockMatchProject;
    get = mockRegistryGet;
  },
}));

const mockCreate = vi.fn();
vi.mock('../project-creator.js', () => ({
  ProjectCreator: class MockProjectCreator {
    create = mockCreate;
  },
}));

const mockEnqueue = vi.fn().mockImplementation(
  async function enqueue(_id: string, _msg: unknown, handler: () => Promise<void>) {
    await handler();
  },
);
const mockGetDepth = vi.fn().mockReturnValue(0);
const mockGetStats = vi.fn().mockReturnValue({});
const mockGetActiveProjects = vi.fn().mockReturnValue([]);
vi.mock('../../queue/project-queue.js', () => ({
  ProjectQueue: class MockProjectQueue {
    enqueue = mockEnqueue;
    getDepth = mockGetDepth;
    getStats = mockGetStats;
    getActiveProjects = mockGetActiveProjects;
  },
}));

const mockBridgeRun = vi.fn().mockResolvedValue({ taskId: 'test', success: true, output: 'done', durationMs: 100 });
vi.mock('../../bridge/claude-cli-bridge.js', () => ({
  ClaudeCliBridge: class MockClaudeCliBridge {
    run = mockBridgeRun;
  },
}));

vi.mock('../../health/process-watcher.js', () => ({
  ProcessWatcher: class MockProcessWatcher {
    register = vi.fn();
    unregister = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  },
}));

vi.mock('../../health/notifier.js', () => ({
  Notifier: class MockNotifier {
    send = vi.fn();
  },
}));

import { ProjectRouter } from '../project-router.js';
import type { AppConfig } from '../../config/loader.js';
import { makeMessage, makeProject } from '../../__tests__/fixtures.js';
import { ProcessWatcher } from '../../health/process-watcher.js';

function makeConfig(): AppConfig {
  return {
    channels: {},
    server: { port: 3000, host: '0.0.0.0' },
    queue: { concurrency: 1, maxRetries: 3, retryDelayMs: 5000 },
    health: { intervalMs: 30000, port: 3001 },
    registry: { projectsPath: '/tmp/projects.json', agentsPath: '/tmp/agents.json' },
  };
}

describe('ProjectRouter', () => {
  let router: ProjectRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDepth.mockReturnValue(0);
    mockGetStats.mockReturnValue({});
    mockGetActiveProjects.mockReturnValue([]);
    mockMatchProject.mockResolvedValue(null);
    mockRegistryGet.mockResolvedValue(null);
    mockEnqueue.mockImplementation(
      async function enqueue(_id: string, _msg: unknown, handler: () => Promise<void>) {
        await handler();
      },
    );
    mockBridgeRun.mockResolvedValue({ taskId: 'test', success: true, output: 'done', durationMs: 100 });
    router = new ProjectRouter(makeConfig(), new ProcessWatcher());
  });

  describe('init()', () => {
    it('loads project registry', async () => {
      await router.init();
      expect(mockLoad).toHaveBeenCalled();
    });
  });

  describe('handleMessage()', () => {
    it('creates a new project when no match found', async () => {
      const project = makeProject({ id: 'proj-new', name: 'dev-abc', domain: 'development', path: '/tmp/proj-new' });
      mockMatchProject.mockResolvedValue(null);
      mockCreate.mockResolvedValue(project);

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-new', content: 'implement a new API', replyFn });

      await router.handleMessage(msg);

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        description: 'implement a new API',
      }));
      expect(replyFn).toHaveBeenCalled();
    });

    it('routes to existing project when match found', async () => {
      const project = makeProject({ id: 'proj-existing', domain: 'development', path: '/tmp/proj-existing' });
      mockMatchProject.mockResolvedValue(project);

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-existing', content: 'add feature', replyFn });

      await router.handleMessage(msg);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockBridgeRun).toHaveBeenCalled();
    });

    it('sends queue depth notification when tasks are queued', async () => {
      const project = makeProject({ id: 'proj-q', path: '/tmp/proj-q' });
      mockMatchProject.mockResolvedValue(project);
      mockGetDepth.mockReturnValue(3);

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-q', content: 'task', replyFn });

      await router.handleMessage(msg);

      const queueReply = replyFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('3'),
      );
      expect(queueReply).toBeDefined();
    });

    it('replies with error message on unhandled exception', async () => {
      mockMatchProject.mockRejectedValue(new Error('registry crash'));

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-err', content: 'test', replyFn });

      await router.handleMessage(msg);

      const errorReply = replyFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('registry crash'),
      );
      expect(errorReply).toBeDefined();
    });

    it('does not throw when error reply itself fails', async () => {
      mockMatchProject.mockRejectedValue(new Error('crash'));

      const replyFn = vi.fn().mockRejectedValue(new Error('reply fail'));
      const msg = makeMessage({ id: 'msg-double-err', content: 'test', replyFn });

      await expect(router.handleMessage(msg)).resolves.toBeUndefined();
    });

    it('sends success reply when bridge run succeeds', async () => {
      const project = makeProject({ id: 'proj-ok', path: '/tmp/proj-ok' });
      mockMatchProject.mockResolvedValue(project);
      mockBridgeRun.mockResolvedValue({
        taskId: 'task-ok',
        success: true,
        output: 'all good',
        durationMs: 200,
      });

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-ok', content: 'do stuff', replyFn });

      await router.handleMessage(msg);

      expect(replyFn).toHaveBeenCalled();
    });

    it('sends error reply when bridge run fails', async () => {
      const project = makeProject({ id: 'proj-fail', path: '/tmp/proj-fail' });
      mockMatchProject.mockResolvedValue(project);
      mockBridgeRun.mockResolvedValue({
        taskId: 'task-fail',
        success: false,
        output: 'exec failed badly',
        durationMs: 100,
      });

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-fail', content: 'do stuff', replyFn });

      await router.handleMessage(msg);

      const errorReply = replyFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('exec failed badly'),
      );
      expect(errorReply).toBeDefined();
    });
  });

  describe('getQueueStats()', () => {
    it('delegates to project queue', () => {
      mockGetStats.mockReturnValue({ 'proj-1': { size: 2, pending: 1 } });
      const stats = router.getQueueStats();
      expect(stats).toEqual({ 'proj-1': { size: 2, pending: 1 } });
    });
  });

  describe('getActiveProjects()', () => {
    it('delegates to project queue', () => {
      mockGetActiveProjects.mockReturnValue(['proj-1', 'proj-2']);
      const active = router.getActiveProjects();
      expect(active).toEqual(['proj-1', 'proj-2']);
    });
  });
});
