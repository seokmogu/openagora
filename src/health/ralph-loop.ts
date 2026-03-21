import { logger } from '../utils/logger.js';

interface Feedback {
  testCount: number;
  lintErrors: number;
  buildSuccess: boolean;
  coveragePct: number;
  timestamp: Date;
}

interface RalphOptions {
  maxIterations: number;
  maxCostUsd: number;
  maxDurationMs: number;
  stagnationDetect: boolean;
}

export type RalphDecision = 'continue' | 'converge' | 'abort' | 'request-review';

const DEFAULT_OPTIONS: RalphOptions = {
  maxIterations: 100,
  maxCostUsd: 10,
  maxDurationMs: 2 * 60 * 60 * 1000,
  stagnationDetect: true,
};

export class RalphLoop {
  private iterations = 0;
  private startTime = Date.now();
  private costUsd = 0;
  private feedbackHistory: Feedback[] = [];
  private options: RalphOptions;

  constructor(options: Partial<RalphOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  decide(feedback: Feedback): RalphDecision {
    this.iterations++;
    this.feedbackHistory.push(feedback);

    logger.debug('RalphLoop decision', {
      iteration: this.iterations,
      buildSuccess: feedback.buildSuccess,
      lintErrors: feedback.lintErrors,
      testCount: feedback.testCount,
      coveragePct: feedback.coveragePct,
      costUsd: this.costUsd,
    });

    // 1. Max iterations exceeded
    if (this.iterations >= this.options.maxIterations) {
      logger.warn('RalphLoop aborting: max iterations reached', { iterations: this.iterations });
      return 'abort';
    }

    // 2. All quality gates pass
    if (this.allGatesPass(feedback)) {
      logger.info('RalphLoop converging: all quality gates pass', { iteration: this.iterations });
      return 'converge';
    }

    // 3. Stagnation detection: no improvement vs previous feedback
    if (this.options.stagnationDetect && this.isStagnant()) {
      logger.info('RalphLoop converging: stagnation detected', { iteration: this.iterations });
      return 'converge';
    }

    // 4. Cost or time exceeded
    if (!this.isWithinLimits()) {
      logger.warn('RalphLoop aborting: limits exceeded', {
        costUsd: this.costUsd,
        elapsedMs: Date.now() - this.startTime,
      });
      return 'abort';
    }

    // 5. Default: continue
    return 'continue';
  }

  recordCost(usd: number): void {
    this.costUsd += usd;
    logger.debug('RalphLoop cost recorded', { added: usd, total: this.costUsd });
  }

  getIterations(): number {
    return this.iterations;
  }

  isWithinLimits(): boolean {
    const elapsed = Date.now() - this.startTime;
    return this.costUsd <= this.options.maxCostUsd && elapsed <= this.options.maxDurationMs;
  }

  private allGatesPass(feedback: Feedback): boolean {
    return feedback.buildSuccess && feedback.lintErrors === 0 && feedback.testCount > 0;
  }

  private isStagnant(): boolean {
    const history = this.feedbackHistory;
    if (history.length < 2) return false;

    const prev = history[history.length - 2];
    const curr = history[history.length - 1];

    if (prev === undefined || curr === undefined) return false;

    const sameTests = curr.testCount === prev.testCount;
    const sameLint = curr.lintErrors === prev.lintErrors;
    const sameBuild = curr.buildSuccess === prev.buildSuccess;
    const sameCoverage = curr.coveragePct === prev.coveragePct;

    return sameTests && sameLint && sameBuild && sameCoverage;
  }
}
