import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const mockGetAgentForDomain = vi.fn().mockReturnValue('expert-developer');
vi.mock('../../agents/registry.js', () => ({
  AgentRegistry: class MockAgentRegistry {
    getAgentForDomain = mockGetAgentForDomain;
    isKnown = vi.fn().mockReturnValue(true);
  },
}));

// AgentExecutor needs static detectDomain method
vi.mock('../../agents/executor.js', () => ({
  AgentExecutor: class MockAgentExecutor {
    run = vi.fn().mockResolvedValue({ success: true, output: 'done', durationMs: 100 });
    static detectDomain(content: string) {
      const lower = content.toLowerCase();
      if (/\b(code|implement|build|develop|api|bug|fix)\b/.test(lower)) return 'development';
      if (/\b(sql|schema|database)\b/.test(lower)) return 'database';
      if (/\b(research|study)\b/.test(lower)) return 'research';
      return 'general';
    }
  },
}));

vi.mock('../../agents/builder-agent.js', () => ({
  BuilderAgent: class MockBuilderAgent {
    create = vi.fn().mockResolvedValue({ agentId: 'expert-blockchain' });
  },
}));

const mockOrchestratorRun = vi.fn().mockResolvedValue({
  success: true,
  primary: { output: 'primary out', success: true },
  review: { status: 'skipped' },
  verify: { status: 'skipped' },
  summary: 'result summary',
  durationMs: 500,
});
vi.mock('../../models/multi-stage.js', () => ({
  MultiStageOrchestrator: class MockMultiStageOrchestrator {
    run = mockOrchestratorRun;
  },
}));

vi.mock('../../agents/p2p-router.js', () => ({
  P2PRouter: class MockP2PRouter {},
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
    models: {},
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
    mockOrchestratorRun.mockResolvedValue({
      success: true,
      primary: { output: 'primary out', success: true },
      review: { status: 'skipped' },
      verify: { status: 'skipped' },
      summary: 'result summary',
      durationMs: 500,
    });
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
        domain: 'development',
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
      expect(mockOrchestratorRun).toHaveBeenCalled();
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

    it('sends success reply when orchestrator succeeds', async () => {
      const project = makeProject({ id: 'proj-ok', path: '/tmp/proj-ok' });
      mockMatchProject.mockResolvedValue(project);
      mockOrchestratorRun.mockResolvedValue({
        success: true,
        primary: { output: 'ok', success: true },
        summary: 'all good',
        durationMs: 200,
      });

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const msg = makeMessage({ id: 'msg-ok', content: 'do stuff', replyFn });

      await router.handleMessage(msg);

      const successReply = replyFn.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('all good'),
      );
      expect(successReply).toBeDefined();
    });

    it('sends error reply when orchestrator fails', async () => {
      const project = makeProject({ id: 'proj-fail', path: '/tmp/proj-fail' });
      mockMatchProject.mockResolvedValue(project);
      mockOrchestratorRun.mockResolvedValue({
        success: false,
        primary: { output: 'exec failed badly', success: false },
        summary: 'failed',
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

  describe('handleDiscoveredTask()', () => {
    it('ignores task when project is unknown', async () => {
      mockRegistryGet.mockResolvedValue(null);

      await router.handleDiscoveredTask({
        projectId: 'unknown-proj',
        projectPath: '/tmp/unknown',
        reason: 'test',
        content: 'test content',
        priority: 1,
      });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('creates synthetic message and handles it when project exists', async () => {
      const project = makeProject({ id: 'proj-disc', path: '/tmp/proj-disc' });
      mockRegistryGet.mockResolvedValue(project);
      mockMatchProject.mockResolvedValue(project);

      await router.handleDiscoveredTask({
        projectId: 'proj-disc',
        projectPath: '/tmp/proj-disc',
        reason: 'goals.md incomplete',
        content: 'complete the goals',
        priority: 1,
      });

      expect(mockEnqueue).toHaveBeenCalled();
    });
  });
});
