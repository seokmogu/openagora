import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('node:util', () => ({
  promisify: () => (...args: unknown[]) => mockExecFile(...args),
}));

import { WorktreeManager } from '../worktree.js';

describe('WorktreeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPath()', () => {
    it('generates correct worktree path', () => {
      const result = WorktreeManager.getPath('/home/user/project', 'task-123');
      expect(result).toBe('/home/user/project/.trees/task-task-123');
    });
  });

  describe('create()', () => {
    it('runs git worktree add and returns path', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await WorktreeManager.create('/home/user/project', 'task-1');

      expect(result).toBe('/home/user/project/.trees/task-task-1');
      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'add', '--detach', '/home/user/project/.trees/task-task-1', 'HEAD'],
        { cwd: '/home/user/project' },
      );
    });

    it('returns null on git command error', async () => {
      mockExecFile.mockRejectedValue(new Error('not a git repo'));

      const result = await WorktreeManager.create('/tmp/not-git', 'task-1');
      expect(result).toBeNull();
    });
  });

  describe('remove()', () => {
    it('runs git worktree remove', async () => {
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await WorktreeManager.remove('/home/user/project', 'task-1');

      expect(mockExecFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', '--force', '/home/user/project/.trees/task-task-1'],
        { cwd: '/home/user/project' },
      );
    });

    it('handles remove failure gracefully', async () => {
      mockExecFile.mockRejectedValue(new Error('worktree not found'));

      // Should not throw
      await expect(WorktreeManager.remove('/tmp/proj', 'task-1')).resolves.toBeUndefined();
    });
  });
});
