import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock ModelRouter
const mockGetRoute = vi.fn();
const mockModelRun = vi.fn();
const mockIsModelAvailable = vi.fn().mockReturnValue(true);
const mockFindAvailable = vi.fn().mockImplementation((candidates: string[]) => candidates[0] ?? null);
vi.mock('../router.js', () => ({
  ModelRouter: class MockModelRouter {
    getRoute = mockGetRoute;
    run = mockModelRun;
    runWithModel = mockModelRun;
    isModelAvailable = mockIsModelAvailable;
    findAvailable = mockFindAvailable;
  },
}));

// Mock RalphLoop
const mockDecide = vi.fn();
const mockGetIterations = vi.fn().mockReturnValue(0);
vi.mock('../../health/ralph-loop.js', () => ({
  RalphLoop: class MockRalphLoop {
    decide = mockDecide;
    getIterations = mockGetIterations;
  },
}));

// Mock P2PRouter -- needs static parse method; use vi.hoisted to avoid TDZ
const { mockP2PParse } = vi.hoisted(() => ({
  mockP2PParse: vi.fn().mockReturnValue([]),
}));
vi.mock('../../agents/p2p-router.js', () => ({
  P2PRouter: class MockP2PRouter {
    static parse = mockP2PParse;
  },
}));

import { MultiStageOrchestrator } from '../multi-stage.js';
import type { AgentExecutor, ExecutionResult } from '../../agents/executor.js';
import type { P2PRouter } from '../../agents/p2p-router.js';
import { makeQueuedTask } from '../../__tests__/fixtures.js';

function makeExecutor(runResult?: Partial<ExecutionResult>): AgentExecutor {
  return {
    run: vi.fn().mockResolvedValue({
      taskId: 'task-1',
      agentId: 'expert-developer',
      success: true,
      output: 'primary output',
      durationMs: 100,
      ...runResult,
    }),
  } as unknown as AgentExecutor;
}

describe('MultiStageOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRoute.mockReturnValue({ primary: 'claude' });
    mockP2PParse.mockReturnValue([]);
  });

  describe('run() - primary stage', () => {
    it('returns result with skipped review/verify when route has no secondaries', async () => {
      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask({ id: 'task-primary' });
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.success).toBe(true);
      expect(result.primary.success).toBe(true);
      expect(result.review.status).toBe('skipped');
      expect(result.verify.status).toBe('skipped');
      expect(result.taskId).toBe('task-primary');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns failure when primary executor fails', async () => {
      const executor = makeExecutor({ success: false, output: 'exec error' });
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask({ id: 'task-fail' });
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.success).toBe(false);
      expect(result.review.status).toBe('skipped');
      expect(result.verify.status).toBe('skipped');
      expect(result.summary).toBe('exec error');
    });
  });

  describe('run() - secondary stages', () => {
    it('runs review stage when route includes review model', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', review: 'codex' });
      mockModelRun.mockResolvedValue({ output: 'review: PASS', model: 'codex', role: 'review' });

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.review.status).toBe('ok');
      expect(result.review.model).toBe('codex');
      expect(result.review.output).toBe('review: PASS');
    });

    it('runs verify stage when route includes verify model', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', verify: 'gemini' });
      mockModelRun.mockResolvedValue({ output: 'VERIFIED', model: 'gemini', role: 'verify' });

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.verify.status).toBe('ok');
      expect(result.verify.output).toBe('VERIFIED');
      expect(result.convergedReason).toBe('verified');
    });

    it('handles review stage timeout gracefully', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', review: 'codex' });
      mockModelRun.mockRejectedValue(new Error('review stage timed out after 300000ms'));

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.review.status).toBe('timeout');
      expect(result.review.error).toContain('timed out');
    });

    it('handles review stage error gracefully', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', review: 'codex' });
      mockModelRun.mockRejectedValue(new Error('API connection refused'));

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.review.status).toBe('error');
      expect(result.review.error).toContain('connection refused');
    });
  });

  describe('run() - P2P delegation', () => {
    it('appends P2P outputs to primary output when delegations found', async () => {
      const mockP2PRouterInstance = { route: vi.fn().mockResolvedValue(['[expert-dba]: schema done']) };
      mockP2PParse.mockReturnValue([{ to: 'expert-dba', task: 'design schema' }]);

      const executor = makeExecutor({ output: 'primary result' });
      const orch = new MultiStageOrchestrator(
        executor,
        '/config',
        mockP2PRouterInstance as unknown as P2PRouter,
      );

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.success).toBe(true);
      expect(result.primary.output).toContain('primary result');
      expect(result.primary.output).toContain('[expert-dba]: schema done');
    });
  });

  describe('run() - RalphLoop retry', () => {
    it('enters RalphLoop when verify returns UNVERIFIED', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', verify: 'gemini' });
      // First verify: UNVERIFIED, RalphLoop decides continue, second verify: VERIFIED
      mockModelRun
        .mockResolvedValueOnce({ output: 'UNVERIFIED: issues found', model: 'gemini', role: 'verify' })
        .mockResolvedValueOnce({ output: 'VERIFIED', model: 'gemini', role: 'verify' });

      mockDecide.mockReturnValueOnce('continue');
      mockGetIterations.mockReturnValue(1);

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.convergedReason).toBe('verified');
    });

    it('stops with stagnation when verify text is identical across rounds', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', verify: 'gemini' });
      const sameOutput = 'UNVERIFIED: same issues';
      mockModelRun
        .mockResolvedValueOnce({ output: sameOutput, model: 'gemini', role: 'verify' })
        .mockResolvedValueOnce({ output: sameOutput, model: 'gemini', role: 'verify' });

      mockDecide.mockReturnValue('continue');
      mockGetIterations.mockReturnValue(1);

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.convergedReason).toBe('stagnation');
    });

    it('stops when RalphLoop returns abort', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', verify: 'gemini' });
      mockModelRun.mockResolvedValue({ output: 'UNVERIFIED', model: 'gemini', role: 'verify' });
      mockDecide.mockReturnValue('abort');
      mockGetIterations.mockReturnValue(5);

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      expect(result.convergedReason).toBe('max-iterations');
    });

    it('treats PARTIALLY_VERIFIED as verified since it contains VERIFIED', async () => {
      mockGetRoute.mockReturnValue({ primary: 'claude', verify: 'gemini' });
      mockModelRun.mockResolvedValue({ output: 'PARTIALLY_VERIFIED', model: 'gemini', role: 'verify' });

      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      const task = makeQueuedTask();
      const result = await orch.run(task, 'expert-developer', '/proj', 'development');

      // PARTIALLY_VERIFIED contains "VERIFIED" and not "UNVERIFIED" -> isVerifyPassing returns true
      expect(result.convergedReason).toBe('verified');
    });
  });

  describe('run() - domain capability mapping', () => {
    it('maps development domain to best-coding capability', async () => {
      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      await orch.run(makeQueuedTask(), 'expert-developer', '/proj', 'development');

      expect(mockGetRoute).toHaveBeenCalledWith('best-coding');
    });

    it('maps research domain to best-research capability', async () => {
      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      await orch.run(makeQueuedTask(), 'expert-researcher', '/proj', 'research');

      expect(mockGetRoute).toHaveBeenCalledWith('best-research');
    });

    it('maps writing domain to best-writing capability', async () => {
      const executor = makeExecutor();
      const orch = new MultiStageOrchestrator(executor, '/config');

      await orch.run(makeQueuedTask(), 'expert-writer', '/proj', 'writing');

      expect(mockGetRoute).toHaveBeenCalledWith('best-writing');
    });
  });
});
