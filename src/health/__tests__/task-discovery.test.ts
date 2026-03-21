import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockReadFile = vi.fn();
const mockExecFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('node:util', () => ({
  promisify: () => (...args: unknown[]) => mockExecFile(...args),
}));

import { TaskDiscovery } from '../task-discovery.js';

describe('TaskDiscovery', () => {
  const onDiscover = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start() / stop()', () => {
    it('starts scanning interval', () => {
      const td = new TaskDiscovery({ onDiscover, intervalMs: 5000 });
      td.start();
      td.stop();
    });

    it('stop clears interval', () => {
      const td = new TaskDiscovery({ onDiscover });
      td.start();
      td.stop();
      // Calling stop again should be safe
      td.stop();
    });
  });

  describe('scanProjects()', () => {
    it('invokes callback with discovered tasks from goals.md', async () => {
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('goals.md')) {
          return Promise.resolve('- [ ] Fix bug\n- [x] Done task\n- [ ] Another task');
        }
        return Promise.reject(new Error('ENOENT'));
      });
      mockExecFile.mockRejectedValue(new Error('not a git repo'));

      const td = new TaskDiscovery({ onDiscover });
      await td.scanProjects([{ id: 'proj-1', path: '/tmp/proj' }]);

      expect(onDiscover).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          reason: 'goals.md has incomplete items',
          priority: 1,
        }),
      );
    });

    it('detects uncommitted changes', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT')); // no goals.md, no test-results.txt
      mockExecFile.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('--porcelain')) {
          return Promise.resolve({ stdout: ' M file.ts\n' });
        }
        if (args.includes('--name-only')) {
          return Promise.resolve({ stdout: 'file.ts\n' });
        }
        return Promise.resolve({ stdout: '' });
      });

      const td = new TaskDiscovery({ onDiscover });
      await td.scanProjects([{ id: 'proj-1', path: '/tmp/proj' }]);

      expect(onDiscover).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          reason: 'uncommitted changes detected',
          priority: 3,
        }),
      );
    });

    it('detects test failures from marker file', async () => {
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('test-results.txt')) {
          return Promise.resolve('FAIL src/test.ts');
        }
        return Promise.reject(new Error('ENOENT'));
      });
      mockExecFile.mockRejectedValue(new Error('not a git repo'));

      const td = new TaskDiscovery({ onDiscover });
      await td.scanProjects([{ id: 'proj-1', path: '/tmp/proj' }]);

      expect(onDiscover).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          reason: 'test failures detected',
          priority: 2,
        }),
      );
    });

    it('handles onDiscover errors gracefully', async () => {
      mockReadFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith('goals.md')) {
          return Promise.resolve('- [ ] Fix bug');
        }
        return Promise.reject(new Error('ENOENT'));
      });
      mockExecFile.mockRejectedValue(new Error('not a git repo'));
      onDiscover.mockRejectedValueOnce(new Error('callback error'));

      const td = new TaskDiscovery({ onDiscover });
      // Should not throw
      await expect(td.scanProjects([{ id: 'proj-1', path: '/tmp/proj' }])).resolves.toBeUndefined();
    });
  });
});
