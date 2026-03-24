import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/platform.js', () => ({
  homeDir: () => '/tmp/test-home',
}));

// Mock child_process.spawn
const mockOn = vi.fn();
const mockStdout = { on: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockKill = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdout: mockStdout,
    stderr: mockStderr,
    on: mockOn,
    kill: mockKill,
  })),
}));

import { ClaudeCliBridge } from '../claude-cli-bridge.js';

function makeWatcher() {
  return { register: vi.fn(), unregister: vi.fn() } as any;
}

describe('ClaudeCliBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns claude with correct args', async () => {
    const bridge = new ClaudeCliBridge(makeWatcher());
    const { spawn } = await import('node:child_process');

    // Simulate successful close
    mockOn.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') setTimeout(() => cb(0), 10);
    });
    mockStdout.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('hello')), 5);
    });
    mockStderr.on.mockImplementation(() => {});

    const result = await bridge.run('/tmp/project', 'test prompt', 'task-1');

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '--dangerously-skip-permissions', 'test prompt'],
      expect.objectContaining({ cwd: '/tmp/project' }),
    );
    expect(result.success).toBe(true);
  });

  it('returns failure on non-zero exit', async () => {
    const bridge = new ClaudeCliBridge(makeWatcher());

    mockOn.mockImplementation((event: string, cb: Function) => {
      if (event === 'close') setTimeout(() => cb(1), 10);
    });
    mockStdout.on.mockImplementation(() => {});
    mockStderr.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'data') setTimeout(() => cb(Buffer.from('error msg')), 5);
    });

    const result = await bridge.run('/tmp/project', 'test', 'task-2');
    expect(result.success).toBe(false);
  });
});
