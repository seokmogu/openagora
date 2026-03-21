import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { Notifier } from '../notifier.js';
import type { NotifyPayload } from '../notifier.js';

function makePayload(overrides?: Partial<NotifyPayload>): NotifyPayload {
  return {
    title: 'Test Title',
    body: 'Test body message',
    level: 'info',
    ...overrides,
  };
}

describe('Notifier', () => {
  const originalEnv = { ...process.env };
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SLACK_NOTIFY_WEBHOOK'];
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_NOTIFY_CHAT_ID'];
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe('isConfigured', () => {
    it('returns false when no env vars are set', () => {
      const notifier = new Notifier();
      expect(notifier.isConfigured).toBe(false);
    });

    it('returns true when Slack webhook is set', () => {
      process.env['SLACK_NOTIFY_WEBHOOK'] = 'https://hooks.slack.com/test';
      const notifier = new Notifier();
      expect(notifier.isConfigured).toBe(true);
    });

    it('returns true when Telegram token and chat ID are set', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
      process.env['TELEGRAM_NOTIFY_CHAT_ID'] = 'chat-123';
      const notifier = new Notifier();
      expect(notifier.isConfigured).toBe(true);
    });

    it('returns false when only Telegram token is set without chat ID', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
      const notifier = new Notifier();
      expect(notifier.isConfigured).toBe(false);
    });
  });

  describe('send()', () => {
    it('posts to Slack webhook when configured', async () => {
      process.env['SLACK_NOTIFY_WEBHOOK'] = 'https://hooks.slack.com/test';
      const notifier = new Notifier();

      await notifier.send(makePayload());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/test');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.text).toContain('Test Title');
    });

    it('posts to Telegram when configured', async () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'bot-token';
      process.env['TELEGRAM_NOTIFY_CHAT_ID'] = 'chat-123';
      const notifier = new Notifier();

      await notifier.send(makePayload());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('api.telegram.org/botbot-token/sendMessage');
      const body = JSON.parse(opts.body);
      expect(body.chat_id).toBe('chat-123');
      expect(body.parse_mode).toBe('Markdown');
    });

    it('skips channels without env vars', async () => {
      const notifier = new Notifier();
      await notifier.send(makePayload());

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('formats message correctly with all fields', async () => {
      process.env['SLACK_NOTIFY_WEBHOOK'] = 'https://hooks.slack.com/test';
      const notifier = new Notifier();

      await notifier.send(makePayload({
        projectId: 'proj-1',
        agentId: 'agent-1',
        durationMs: 5000,
        level: 'success',
      }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('proj-1');
      expect(body.text).toContain('agent-1');
      expect(body.text).toContain('5.0s');
    });

    it('handles fetch failure gracefully', async () => {
      process.env['SLACK_NOTIFY_WEBHOOK'] = 'https://hooks.slack.com/test';
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const notifier = new Notifier();

      // Should not throw
      await expect(notifier.send(makePayload())).resolves.toBeUndefined();
    });
  });
});
