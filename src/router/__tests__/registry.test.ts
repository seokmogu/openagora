import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

import { ProjectRegistry } from '../registry.js';
import { makeProject } from '../../__tests__/fixtures.js';

function makeRegistryFile(projects: unknown[]) {
  return JSON.stringify({ version: '1.0', projects });
}

describe('ProjectRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('load()', () => {
    it('reads and parses JSON file', async () => {
      const project = makeProject();
      mockReadFile.mockResolvedValue(
        makeRegistryFile([{ ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() }]),
      );

      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.get('proj-1');
      expect(result).toBeDefined();
      expect(result!.name).toBe('test-project');
    });

    it('returns empty when file not found (ENOENT)', async () => {
      const err = new Error('not found') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      mockReadFile.mockRejectedValue(err);

      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const all = await registry.getAll();
      expect(all).toHaveLength(0);
    });

    it('throws on non-ENOENT errors', async () => {
      mockReadFile.mockRejectedValue(new Error('permission denied'));

      const registry = new ProjectRegistry('/tmp/projects.json');
      await expect(registry.load()).rejects.toThrow('permission denied');
    });
  });

  describe('save()', () => {
    it('writes JSON to file', async () => {
      mockReadFile.mockResolvedValue(makeRegistryFile([]));
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();
      await registry.save();

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/projects.json',
        expect.any(String),
        'utf-8',
      );
      const written = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(written.version).toBe('1.0');
    });
  });

  describe('create()', () => {
    it('adds project to registry and saves', async () => {
      mockReadFile.mockResolvedValue(makeRegistryFile([]));
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const project = await registry.create({
        name: 'My Project',
        domain: 'development',
        githubUser: 'testuser',
      });

      expect(project.id).toBe('my-project');
      expect(project.name).toBe('My Project');
      expect(project.status).toBe('active');
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    it('returns matching project by id', async () => {
      const proj = makeProject();
      mockReadFile.mockResolvedValue(
        makeRegistryFile([{ ...proj, createdAt: proj.createdAt.toISOString(), updatedAt: proj.updatedAt.toISOString() }]),
      );
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.get('proj-1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('proj-1');
    });

    it('returns undefined for non-existing id', async () => {
      mockReadFile.mockResolvedValue(makeRegistryFile([]));
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.get('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getActive()', () => {
    it('filters by active status', async () => {
      const active = makeProject({ id: 'active-1', status: 'active' });
      const paused = makeProject({ id: 'paused-1', status: 'paused' });
      mockReadFile.mockResolvedValue(
        makeRegistryFile([
          { ...active, createdAt: active.createdAt.toISOString(), updatedAt: active.updatedAt.toISOString() },
          { ...paused, createdAt: paused.createdAt.toISOString(), updatedAt: paused.updatedAt.toISOString() },
        ]),
      );

      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.getActive();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('active-1');
    });
  });

  describe('matchProject()', () => {
    it('matches by project keyword pattern', async () => {
      const proj = makeProject({ id: 'myapp', name: 'myapp' });
      mockReadFile.mockResolvedValue(
        makeRegistryFile([{ ...proj, createdAt: proj.createdAt.toISOString(), updatedAt: proj.updatedAt.toISOString() }]),
      );
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.matchProject('project myapp do something');
      expect(result).toBeDefined();
      expect(result!.id).toBe('myapp');
    });

    it('matches by #hashtag pattern', async () => {
      const proj = makeProject({ id: 'myapp', name: 'myapp' });
      mockReadFile.mockResolvedValue(
        makeRegistryFile([{ ...proj, createdAt: proj.createdAt.toISOString(), updatedAt: proj.updatedAt.toISOString() }]),
      );
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.matchProject('#myapp fix this');
      expect(result).toBeDefined();
      expect(result!.id).toBe('myapp');
    });

    it('falls back to name substring match', async () => {
      const proj = makeProject({ id: 'myapp', name: 'myapp' });
      mockReadFile.mockResolvedValue(
        makeRegistryFile([{ ...proj, createdAt: proj.createdAt.toISOString(), updatedAt: proj.updatedAt.toISOString() }]),
      );
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.matchProject('please work on myapp');
      expect(result).toBeDefined();
      expect(result!.id).toBe('myapp');
    });

    it('returns undefined when no match', async () => {
      mockReadFile.mockResolvedValue(makeRegistryFile([]));
      const registry = new ProjectRegistry('/tmp/projects.json');
      await registry.load();

      const result = await registry.matchProject('random text');
      expect(result).toBeUndefined();
    });
  });
});
