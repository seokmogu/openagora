import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before imports
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: function spawn(...args: unknown[]) { return mockSpawn(...args); } }));

// Mock CircuitBreakerRegistry
const mockBreaker = {
  isOpen: vi.fn().mockReturnValue(false),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
};
vi.mock('../../health/circuit-breaker.js', () => ({
  CircuitBreakerRegistry: { get: () => mockBreaker },
}));

// Mock WorktreeManager
vi.mock('../../health/worktree.js', () => ({
  WorktreeManager: {
    create: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

import { AgentExecutor } from '../executor.js';
import { WorktreeManager } from '../../health/worktree.js';
import type { ProcessWatcher } from '../../health/process-watcher.js';
import { makeQueuedTask } from '../../__tests__/fixtures.js';

function createMockProcessWatcher(): ProcessWatcher {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    heartbeat: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as ProcessWatcher;
}

/** Helper: create a fake ChildProcess with controllable stdout/stderr/close. */
function makeFakeChild(opts: { pid?: number; stdout?: string; stderr?: string; exitCode?: number; error?: Error }) {
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  const closeListeners: Array<(code: number | null) => void> = [];
  const errorListeners: Array<(err: Error) => void> = [];

  const child = {
    pid: opts.pid ?? 1234,
    stdout: {
      on: function on(event: string, fn: (chunk: Buffer) => void) { if (event === 'data') stdoutListeners.push(fn); },
    },
    stderr: {
      on: function on(event: string, fn: (chunk: Buffer) => void) { if (event === 'data') stderrListeners.push(fn); },
    },
    on: function on(event: string, fn: (...args: unknown[]) => void) {
      if (event === 'close') closeListeners.push(fn as (code: number | null) => void);
      if (event === 'error') errorListeners.push(fn as (err: Error) => void);
    },
    kill: vi.fn(),
  };

  // Delay emission to allow spawnClaudeInDir to set up all listeners and timer
  setTimeout(() => {
    if (opts.error) {
      errorListeners.forEach((fn) => fn(opts.error!));
      return;
    }
    if (opts.stdout) {
      stdoutListeners.forEach((fn) => fn(Buffer.from(opts.stdout!)));
    }
    if (opts.stderr) {
      stderrListeners.forEach((fn) => fn(Buffer.from(opts.stderr!)));
    }
    closeListeners.forEach((fn) => fn(opts.exitCode ?? 0));
  }, 0);

  return child;
}

describe('AgentExecutor', () => {
  let executor: AgentExecutor;
  let watcher: ProcessWatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBreaker.isOpen.mockReturnValue(false);
    watcher = createMockProcessWatcher();
    executor = new AgentExecutor(watcher);
  });

  describe('run()', () => {
    it('returns successful result when subprocess exits 0', async () => {
      const child = makeFakeChild({ stdout: 'hello world', exitCode: 0 });
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-ok' });
      const result = await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
      expect(result.taskId).toBe('task-ok');
      expect(result.agentId).toBe('expert-developer');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(mockBreaker.recordSuccess).toHaveBeenCalled();
    });

    it('returns failure result when subprocess exits non-zero', async () => {
      const child = makeFakeChild({ stderr: 'bad things', exitCode: 1 });
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-fail' });
      const result = await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(result.success).toBe(false);
      expect(result.output).toContain('claude exited 1');
      expect(mockBreaker.recordFailure).toHaveBeenCalled();
    });

    it('rejects task when circuit breaker is open', async () => {
      mockBreaker.isOpen.mockReturnValue(true);

      const task = makeQueuedTask({ id: 'task-rejected' });
      const result = await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Circuit breaker OPEN');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns failure when spawn emits error', async () => {
      const child = makeFakeChild({ error: new Error('spawn ENOENT') });
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-spawn-err' });
      const result = await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(result.success).toBe(false);
      expect(result.output).toContain('spawn ENOENT');
      expect(mockBreaker.recordFailure).toHaveBeenCalled();
    });

    it('returns failure when child has no pid', async () => {
      const child = makeFakeChild({ pid: undefined as unknown as number, stdout: '' });
      // Override pid to be falsy
      child.pid = 0;
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-no-pid' });
      const result = await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Failed to spawn');
    });

    it('uses worktree path when WorktreeManager.create succeeds', async () => {
      vi.mocked(WorktreeManager.create).mockResolvedValue('/tmp/worktree-path');
      const child = makeFakeChild({ stdout: 'ok', exitCode: 0 });
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-wt' });
      await executor.run(task, 'expert-developer', '/tmp/proj');

      // spawn should use worktree path as cwd
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.objectContaining({ cwd: '/tmp/worktree-path' }),
      );
      expect(WorktreeManager.remove).toHaveBeenCalledWith('/tmp/proj', 'task-wt');
    });

    it('cleans up worktree even on failure', async () => {
      vi.mocked(WorktreeManager.create).mockResolvedValue('/tmp/worktree-cleanup');
      const child = makeFakeChild({ stderr: 'err', exitCode: 1 });
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-wt-fail' });
      await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(WorktreeManager.remove).toHaveBeenCalledWith('/tmp/proj', 'task-wt-fail');
    });

    it('registers and unregisters process with watcher', async () => {
      const child = makeFakeChild({ pid: 9999, stdout: 'done', exitCode: 0 });
      mockSpawn.mockReturnValue(child);

      const task = makeQueuedTask({ id: 'task-watch' });
      await executor.run(task, 'expert-developer', '/tmp/proj');

      expect(watcher.register).toHaveBeenCalledWith(9999, 'task-watch');
      expect(watcher.unregister).toHaveBeenCalledWith(9999);
    });
  });

  describe('detectDomain()', () => {
    it('detects development domain from code keywords', () => {
      expect(AgentExecutor.detectDomain('implement a new API endpoint')).toBe('development');
    });

    it('detects database domain', () => {
      expect(AgentExecutor.detectDomain('design SQL schema for users table')).toBe('database');
    });

    it('detects research domain', () => {
      expect(AgentExecutor.detectDomain('research the latest papers on AI')).toBe('research');
    });

    it('detects writing domain', () => {
      expect(AgentExecutor.detectDomain('write a blog post about TypeScript')).toBe('writing');
    });

    it('detects analysis domain', () => {
      expect(AgentExecutor.detectDomain('analyze the data trends')).toBe('analysis');
    });

    it('detects planning domain', () => {
      expect(AgentExecutor.detectDomain('create a project plan with milestones')).toBe('planning');
    });

    it('returns general for unrecognized content', () => {
      expect(AgentExecutor.detectDomain('hello there')).toBe('general');
    });
  });
});
