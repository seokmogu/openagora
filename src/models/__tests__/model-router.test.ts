import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModelRouter } from '../router.js';
import { join } from 'node:path';

// Real config dir — uses the existing config/models.yaml at project root
const configDir = join(process.cwd(), 'config');

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter(configDir);
  });

  describe('getRoute()', () => {
    it('returns correct capability route for best-coding', () => {
      const route = router.getRoute('best-coding');
      expect(route.primary).toBe('claude');
      expect(route.review).toBe('codex');
      expect(route.verify).toBe('gemini');
    });

    it('returns correct capability route for best-writing', () => {
      const route = router.getRoute('best-writing');
      expect(route.primary).toBe('claude-opus');
    });

    it('returns correct capability route for best-research', () => {
      const route = router.getRoute('best-research');
      expect(route.primary).toBe('perplexity');
      expect(route.synthesis).toBe('claude-opus');
    });

    it('falls back to best-coding for unknown capability', () => {
      // Cast to Capability to test fallback path
      const route = router.getRoute('unknown-capability' as Parameters<ModelRouter['getRoute']>[0]);
      expect(route.primary).toBe('claude');
    });
  });

  describe('getModelConfig()', () => {
    it('returns config for cli model (claude)', () => {
      const cfg = router.getModelConfig('claude');
      expect(cfg.type).toBe('cli');
      expect(cfg.command).toBe('claude');
    });

    it('resolves env var tokens in apiKey', () => {
      const testKey = 'test-api-key-12345';
      process.env['GEMINI_API_KEY'] = testKey;

      const cfg = router.getModelConfig('gemini');
      expect(cfg.apiKey).toBe(testKey);

      delete process.env['GEMINI_API_KEY'];
    });

    it('resolves env var to empty string when env var not set', () => {
      delete process.env['GEMINI_API_KEY'];

      const cfg = router.getModelConfig('gemini');
      expect(cfg.apiKey).toBe('');
    });

    it('throws for unknown model', () => {
      expect(() => router.getModelConfig('nonexistent-model')).toThrow('Unknown model: nonexistent-model');
    });
  });

  afterEach(() => {
    delete process.env['GEMINI_API_KEY'];
    delete process.env['PERPLEXITY_API_KEY'];
  });
});
