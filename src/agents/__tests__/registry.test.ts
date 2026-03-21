import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

import { AgentRegistry } from '../registry.js';

describe('AgentRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor - file missing', () => {
    it('creates default entries when registry file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      new AgentRegistry('/tmp/test-root');

      // Should write defaults
      expect(mockWriteFileSync).toHaveBeenCalled();
      const writtenPath = mockWriteFileSync.mock.calls[0][0];
      expect(writtenPath).toContain('agents.json');
    });
  });

  describe('constructor - file exists', () => {
    it('loads agents from JSON file', () => {
      const agents = [
        {
          id: 'custom-agent',
          name: 'Custom',
          domain: 'general',
          dynamic: true,
          definitionPath: '.claude/agents/custom.md',
          createdAt: '2026-01-01T00:00:00.000Z',
          capabilities: ['test'],
        },
      ];
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(agents));

      const registry = new AgentRegistry('/tmp/test-root');

      expect(registry.has('custom-agent')).toBe(true);
    });

    it('re-initializes when JSON is invalid', () => {
      mockExistsSync.mockImplementation((p: string) => {
        // First call for load: file exists. After re-init, dir check.
        if (p.endsWith('agents.json')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue('INVALID JSON');

      const registry = new AgentRegistry('/tmp/test-root');

      // Should re-init with defaults and persist
      expect(mockWriteFileSync).toHaveBeenCalled();
      // Should have builtin agents
      expect(registry.has('expert-developer')).toBe(true);
    });
  });

  describe('getAgentForDomain()', () => {
    it('returns matching agent for domain', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');

      expect(registry.getAgentForDomain('development')).toBe('expert-developer');
      expect(registry.getAgentForDomain('planning')).toBe('expert-planner');
      expect(registry.getAgentForDomain('database')).toBe('expert-dba');
    });

    it('prefers dynamic agents for same domain', () => {
      const agents = [
        {
          id: 'custom-dev',
          name: 'Custom Dev',
          domain: 'development',
          dynamic: true,
          definitionPath: '.claude/agents/custom.md',
          createdAt: '2026-01-01T00:00:00.000Z',
          capabilities: ['code'],
        },
      ];
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(agents));

      const registry = new AgentRegistry('/tmp/test-root');

      expect(registry.getAgentForDomain('development')).toBe('custom-dev');
    });
  });

  describe('getAllAgents()', () => {
    it('returns all agent definitions', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');

      const all = registry.getAllAgents();
      expect(all.length).toBeGreaterThan(0);
      expect(all[0]).toHaveProperty('id');
      expect(all[0]).toHaveProperty('name');
      expect(all[0]).toHaveProperty('domain');
      expect(all[0]).toHaveProperty('capabilities');
    });
  });

  describe('register()', () => {
    it('adds a new dynamic agent and persists', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');
      vi.clearAllMocks();
      mockExistsSync.mockReturnValue(true); // dir exists for persist

      registry.register({
        id: 'new-agent',
        name: 'New Agent',
        domain: 'general',
        dynamic: true,
        definitionPath: '.claude/agents/new.md',
        capabilities: ['test'],
      });

      expect(registry.has('new-agent')).toBe(true);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('skips registration if agent already exists', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');
      vi.clearAllMocks();

      registry.register({
        id: 'expert-developer',
        name: 'Duplicate',
        domain: 'development',
        dynamic: false,
        definitionPath: '.claude/agents/dev.md',
        capabilities: [],
      });

      // Should not write (skipped)
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe('has() / isKnown()', () => {
    it('returns true for existing agents', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');

      expect(registry.has('expert-developer')).toBe(true);
      expect(registry.isKnown('expert-developer')).toBe(true);
    });

    it('returns false for non-existing agents', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');

      expect(registry.has('non-existent')).toBe(false);
      expect(registry.isKnown('non-existent')).toBe(false);
    });
  });

  describe('getDefinitionPath()', () => {
    it('returns definition path for existing agent', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');

      const path = registry.getDefinitionPath('expert-developer');
      expect(path).toBeDefined();
      expect(path).toContain('.md');
    });

    it('returns undefined for non-existing agent', () => {
      mockExistsSync.mockReturnValue(false);
      const registry = new AgentRegistry('/tmp/test-root');

      expect(registry.getDefinitionPath('non-existent')).toBeUndefined();
    });
  });
});
