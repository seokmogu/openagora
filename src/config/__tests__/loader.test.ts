import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockReadFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

const mockParseYaml = vi.fn();

vi.mock('yaml', () => ({
  parse: (...args: unknown[]) => mockParseYaml(...args),
}));

import { loadConfig } from '../loader.js';

describe('loadConfig()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns defaults when config files not found', async () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockReadFile.mockRejectedValue(err);

    const config = await loadConfig();

    expect(config.channels).toEqual({});
    expect(config.server).toHaveProperty('port');
    expect(config.server).toHaveProperty('host');
    expect(config.queue).toHaveProperty('concurrency');
    expect(config.health).toHaveProperty('intervalMs');
  });

  it('parses YAML file and returns config', async () => {
    const channelsData = { discord: { enabled: true, token: 'tok' } };

    mockReadFile.mockResolvedValueOnce('channels yaml content');
    mockParseYaml.mockReturnValueOnce(channelsData);

    const config = await loadConfig();

    expect(config.channels).toEqual(channelsData);
  });

  it('throws on non-ENOENT errors', async () => {
    mockReadFile.mockRejectedValue(new Error('permission denied'));

    await expect(loadConfig()).rejects.toThrow('permission denied');
  });

  it('merges defaults for missing fields', async () => {
    const err = new Error('not found') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockReadFile.mockRejectedValue(err);

    const config = await loadConfig();

    expect(config.queue.concurrency).toBe(1);
    expect(config.queue.maxRetries).toBe(3);
    expect(config.queue.retryDelayMs).toBe(5000);
    expect(config.health.intervalMs).toBe(30_000);
  });
});
