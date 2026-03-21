import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

const mockGitInit = vi.fn().mockResolvedValue(undefined);
const mockGitAdd = vi.fn().mockResolvedValue(undefined);
const mockGitCommit = vi.fn().mockResolvedValue(undefined);

vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockImplementation(() => ({
    init: mockGitInit,
    add: mockGitAdd,
    commit: mockGitCommit,
  })),
}));

const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock('node:util', () => ({
  promisify: () => (...args: unknown[]) => mockExecFile(...args),
}));

import { ProjectCreator } from '../project-creator.js';
import type { ProjectRegistry } from '../registry.js';
import { makeProject } from '../../__tests__/fixtures.js';

function makeMockRegistry(): ProjectRegistry {
  const proj = makeProject();
  return {
    create: vi.fn().mockResolvedValue(proj),
    update: vi.fn().mockResolvedValue({ ...proj, path: '/tmp/base/test-project' }),
  } as unknown as ProjectRegistry;
}

describe('ProjectCreator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('creates directory and initializes git repo', async () => {
      const registry = makeMockRegistry();
      const creator = new ProjectCreator(registry);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await creator.create({
        name: 'Test Project',
        domain: 'development',
        description: 'A test project',
        baseDir: '/tmp/base',
        githubUser: 'testuser',
      });

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('test-project'),
        { recursive: true },
      );
      expect(mockGitInit).toHaveBeenCalled();
    });

    it('creates CLAUDE.md in project dir', async () => {
      const registry = makeMockRegistry();
      const creator = new ProjectCreator(registry);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await creator.create({
        name: 'Test Project',
        domain: 'development',
        description: 'A test project',
        baseDir: '/tmp/base',
        githubUser: 'testuser',
      });

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('Test Project'),
        'utf-8',
      );
    });

    it('returns created Project object', async () => {
      const registry = makeMockRegistry();
      const creator = new ProjectCreator(registry);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await creator.create({
        name: 'Test Project',
        domain: 'development',
        description: 'A test project',
        baseDir: '/tmp/base',
        githubUser: 'testuser',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('path');
    });

    it('handles GitHub repo creation failure gracefully', async () => {
      const registry = makeMockRegistry();
      const creator = new ProjectCreator(registry);
      mockExecFile.mockRejectedValue(new Error('gh not found'));

      // Should not throw even when gh fails
      const result = await creator.create({
        name: 'Test Project',
        domain: 'development',
        description: 'A test project',
        baseDir: '/tmp/base',
        githubUser: 'testuser',
      });

      expect(result).toBeDefined();
    });

    it('registers project in registry', async () => {
      const registry = makeMockRegistry();
      const creator = new ProjectCreator(registry);
      mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

      await creator.create({
        name: 'Test Project',
        domain: 'development',
        description: 'Test',
        baseDir: '/tmp/base',
        githubUser: 'testuser',
      });

      expect(registry.create).toHaveBeenCalledWith({
        name: 'Test Project',
        domain: 'development',
        githubUser: 'testuser',
      });
      expect(registry.update).toHaveBeenCalled();
    });
  });
});
