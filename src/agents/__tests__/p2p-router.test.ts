import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { P2PRouter } from '../p2p-router.js';
import type { AgentExecutor, ExecutionResult } from '../executor.js';
import type { AgentRegistry } from '../registry.js';
import { makeMessage } from '../../__tests__/fixtures.js';

function makeMockExecutor(result?: Partial<ExecutionResult>): AgentExecutor {
  return {
    run: vi.fn().mockResolvedValue({
      taskId: 'task-1',
      agentId: 'expert-developer',
      success: true,
      output: 'done',
      durationMs: 100,
      ...result,
    }),
  } as unknown as AgentExecutor;
}

function makeMockRegistry(knownIds: string[] = ['expert-dba', 'expert-developer']): AgentRegistry {
  return {
    isKnown: vi.fn().mockImplementation((id: string) => knownIds.includes(id)),
  } as unknown as AgentRegistry;
}

describe('P2PRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parse()', () => {
    it('parses valid DELEGATE blocks from output string', () => {
      const output = 'Some text <!-- DELEGATE: {"to":"expert-dba","task":"Design schema"} --> more text';
      const results = P2PRouter.parse(output);

      expect(results).toHaveLength(1);
      expect(results[0].to).toBe('expert-dba');
      expect(results[0].task).toBe('Design schema');
    });

    it('parses multiple DELEGATE blocks', () => {
      const output = [
        '<!-- DELEGATE: {"to":"expert-dba","task":"Schema"} -->',
        '<!-- DELEGATE: {"to":"expert-writer","task":"Docs"} -->',
      ].join('\n');

      const results = P2PRouter.parse(output);
      expect(results).toHaveLength(2);
    });

    it('returns empty array for no DELEGATE blocks', () => {
      const results = P2PRouter.parse('plain text without delegates');
      expect(results).toHaveLength(0);
    });

    it('handles malformed JSON in DELEGATE block', () => {
      const output = '<!-- DELEGATE: {invalid json} -->';
      const results = P2PRouter.parse(output);
      expect(results).toHaveLength(0);
    });

    it('skips blocks missing required fields', () => {
      const output = '<!-- DELEGATE: {"to":"agent"} -->';
      const results = P2PRouter.parse(output);
      expect(results).toHaveLength(0);
    });
  });

  describe('route()', () => {
    it('executes delegations via AgentExecutor', async () => {
      const executor = makeMockExecutor();
      const registry = makeMockRegistry();
      const router = new P2PRouter(executor, registry);

      const delegations = [{ to: 'expert-dba', task: 'Design schema' }];
      const msg = makeMessage();

      const results = await router.route(delegations, msg, '/tmp/project', 'parent-1');

      expect(executor.run).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('expert-dba');
    });

    it('falls back to expert-developer for unknown agent', async () => {
      const executor = makeMockExecutor();
      const registry = makeMockRegistry(['expert-developer']); // unknown-agent not known
      const router = new P2PRouter(executor, registry);

      const delegations = [{ to: 'unknown-agent', task: 'Do something' }];
      const msg = makeMessage();

      await router.route(delegations, msg, '/tmp/project', 'parent-1');

      const runCall = (executor.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(runCall[1]).toBe('expert-developer');
    });

    it('returns aggregated results from multiple delegations', async () => {
      const executor = makeMockExecutor();
      const registry = makeMockRegistry();
      const router = new P2PRouter(executor, registry);

      const delegations = [
        { to: 'expert-dba', task: 'Task 1' },
        { to: 'expert-developer', task: 'Task 2' },
      ];

      const results = await router.route(delegations, makeMessage(), '/tmp/project', 'parent-1');
      expect(results).toHaveLength(2);
    });

    it('includes failure info when delegation fails', async () => {
      const executor = makeMockExecutor({ success: false, output: 'error occurred' });
      const registry = makeMockRegistry();
      const router = new P2PRouter(executor, registry);

      const delegations = [{ to: 'expert-dba', task: 'Fail task' }];

      const results = await router.route(delegations, makeMessage(), '/tmp/project', 'parent-1');
      expect(results[0]).toContain('(failed)');
    });
  });
});
