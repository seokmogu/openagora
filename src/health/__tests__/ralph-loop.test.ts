import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { RalphLoop } from '../ralph-loop.js';

function makeFeedback(overrides?: Partial<{
  testCount: number;
  lintErrors: number;
  buildSuccess: boolean;
  coveragePct: number;
}>) {
  return {
    testCount: 10,
    lintErrors: 0,
    buildSuccess: true,
    coveragePct: 80,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('RalphLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('decide()', () => {
    it('returns "continue" initially when gates do not pass', () => {
      const loop = new RalphLoop();
      const decision = loop.decide(makeFeedback({ lintErrors: 5, buildSuccess: false }));
      expect(decision).toBe('continue');
    });

    it('returns "converge" when all quality gates pass', () => {
      const loop = new RalphLoop();
      const decision = loop.decide(makeFeedback({
        buildSuccess: true,
        lintErrors: 0,
        testCount: 10,
      }));
      expect(decision).toBe('converge');
    });

    it('returns "abort" on max iterations', () => {
      const loop = new RalphLoop({ maxIterations: 3 });
      loop.decide(makeFeedback({ lintErrors: 1 }));
      loop.decide(makeFeedback({ lintErrors: 1 }));
      const decision = loop.decide(makeFeedback({ lintErrors: 1 }));
      expect(decision).toBe('abort');
    });

    it('detects stagnation after identical iterations', () => {
      const loop = new RalphLoop();
      const feedback = makeFeedback({ lintErrors: 2, buildSuccess: false });
      loop.decide(feedback);
      const decision = loop.decide({ ...feedback, timestamp: new Date() });
      expect(decision).toBe('converge');
    });

    it('does not detect stagnation when stagnationDetect is false', () => {
      const loop = new RalphLoop({ stagnationDetect: false });
      const feedback = makeFeedback({ lintErrors: 2, buildSuccess: false });
      loop.decide(feedback);
      const decision = loop.decide({ ...feedback, timestamp: new Date() });
      expect(decision).toBe('continue');
    });
  });

  describe('recordCost()', () => {
    it('accumulates cost', () => {
      const loop = new RalphLoop({ maxCostUsd: 5 });
      loop.recordCost(2);
      loop.recordCost(1);
      expect(loop.isWithinLimits()).toBe(true);

      loop.recordCost(3);
      expect(loop.isWithinLimits()).toBe(false);
    });
  });

  describe('cost/duration limits', () => {
    it('returns "abort" when cost exceeds limit', () => {
      const loop = new RalphLoop({ maxCostUsd: 1 });
      loop.recordCost(2);
      const decision = loop.decide(makeFeedback({ lintErrors: 1, buildSuccess: false }));
      expect(decision).toBe('abort');
    });
  });

  describe('getIterations()', () => {
    it('tracks iteration count', () => {
      const loop = new RalphLoop();
      expect(loop.getIterations()).toBe(0);
      loop.decide(makeFeedback({ lintErrors: 1, buildSuccess: false }));
      expect(loop.getIterations()).toBe(1);
    });
  });
});
