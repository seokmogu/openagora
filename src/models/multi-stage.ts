import type { DomainType, Capability } from '../types/index.js';
import type { AgentExecutor, ExecutionResult } from '../agents/executor.js';
import type { QueuedTask } from '../types/index.js';
import { ModelRouter } from './router.js';
import { logger } from '../utils/logger.js';
import { RalphLoop } from '../health/ralph-loop.js';
import { P2PRouter } from '../agents/p2p-router.js';

const STAGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min max for secondary stages
const MAX_EMBED_CODE_POINTS = 3000;

/** Maps domain to the most relevant capability route. */
const DOMAIN_CAPABILITY: Record<DomainType, Capability> = {
  development: 'best-coding',
  database:    'best-coding',
  analysis:    'best-analysis',
  research:    'best-research',
  writing:     'best-writing',
  planning:    'best-planning',
  general:     'best-coding',
};

export type StageStatus = 'ok' | 'skipped' | 'timeout' | 'error';

export interface StageResult {
  status: StageStatus;
  model?: string;
  output?: string;
  error?: string;
}

export interface MultiStageResult {
  taskId: string;
  agentId: string;
  success: boolean;
  primary: ExecutionResult;
  review: StageResult;
  verify: StageResult;
  summary: string;
  durationMs: number;
  iterations: number;
  convergedReason?: 'verified' | 'quality-gates' | 'stagnation' | 'max-iterations';
}

/**
 * Truncates text safely for embedding in prompts.
 * - Code-point safe (no split surrogate pairs)
 * - Preserves head (70%) + tail (30%) for context
 * - Marks omission with character count
 */
function truncateForPrompt(text: string, maxCodePoints = MAX_EMBED_CODE_POINTS): string {
  const points = Array.from(text);
  if (points.length <= maxCodePoints) return text;
  const headLen = Math.floor(maxCodePoints * 0.7);
  const tailLen = maxCodePoints - headLen;
  const omitted = points.length - headLen - tailLen;
  return [
    '```\n',
    points.slice(0, headLen).join(''),
    `\n\n[... ${omitted} characters omitted ...]\n\n`,
    points.slice(-tailLen).join(''),
    '\n```',
  ].join('');
}

/** Races a promise against a deadline. Rejects with a timeout error on expiry. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * MultiStageOrchestrator: primary(claude) → review(codex) → verify(gemini).
 * Secondary stages have hard timeouts and return typed StageResult.
 */
export class MultiStageOrchestrator {
  private readonly modelRouter: ModelRouter;

  constructor(
    private readonly executor: AgentExecutor,
    configDir: string,
    private readonly p2pRouter?: P2PRouter,
  ) {
    this.modelRouter = new ModelRouter(configDir);
  }

  async run(
    task: QueuedTask,
    agentId: string,
    projectPath: string,
    domain: DomainType,
  ): Promise<MultiStageResult> {
    const start = Date.now();
    const capability = DOMAIN_CAPABILITY[domain] ?? 'best-coding';
    const route = this.modelRouter.getRoute(capability);

    logger.info('MultiStageOrchestrator: starting', {
      taskId: task.id,
      capability,
      hasReview: !!route.review,
      hasVerify: !!route.verify,
    });

    // Stage 1: Primary execution via claude agent subprocess
    let primary = await this.executor.run(task, agentId, projectPath);

    if (!primary.success) {
      return {
        taskId: task.id,
        agentId,
        success: false,
        primary,
        review: { status: 'skipped' },
        verify: { status: 'skipped' },
        summary: primary.output,
        durationMs: Date.now() - start,
        iterations: 0,
      };
    }

    // P2P delegation: check if primary output contains DELEGATE blocks
    if (this.p2pRouter) {
      const delegations = P2PRouter.parse(primary.output);
      if (delegations.length > 0) {
        logger.info('MultiStageOrchestrator: P2P delegations found', {
          taskId: task.id,
          count: delegations.length,
        });
        const p2pOutputs = await this.p2pRouter.route(
          delegations,
          task.message,
          projectPath,
          task.id,
        );
        // Append P2P results to primary output for downstream review/verify
        primary = {
          ...primary,
          output: [primary.output, ...p2pOutputs].join('\n\n---\n'),
        };
      }
    }

    // Stage 2: Review (e.g. codex) — best-effort with timeout
    const review: StageResult = route.review
      ? await this.runStage('review', task, primary.output, capability)
      : { status: 'skipped' };

    // Stage 3: Verify (e.g. gemini) — best-effort with timeout, with RalphLoop retry
    let verify: StageResult = route.verify
      ? await this.runStage('verify', task, primary.output, capability)
      : { status: 'skipped' };

    let iterations = 0;
    let convergedReason: MultiStageResult['convergedReason'];

    if (route.verify && verify.status === 'ok' && verify.output !== undefined) {
      const isVerified = this.isVerifyPassing(verify.output);

      if (isVerified) {
        convergedReason = 'verified';
      } else {
        // Enter RalphLoop retry cycle
        const ralph = new RalphLoop({ maxIterations: 5 });
        let previousVerifyText: string | undefined;
        let currentTask = task;

        while (true) {
          const verifyText = verify.output ?? '';

          // Stagnation detection: same feedback text as previous round → force converge
          if (previousVerifyText !== undefined && verifyText === previousVerifyText) {
            logger.info('MultiStageOrchestrator: verify text stagnant, converging', {
              taskId: task.id,
              iteration: iterations,
            });
            convergedReason = 'stagnation';
            break;
          }

          const feedback = this.verifyOutputToFeedback(verifyText);
          const decision = ralph.decide(feedback);
          iterations = ralph.getIterations();

          if (decision === 'converge') {
            convergedReason = feedback.buildSuccess ? 'quality-gates' : 'stagnation';
            break;
          }

          if (decision === 'abort' || decision === 'request-review') {
            convergedReason = 'max-iterations';
            break;
          }

          // decision === 'continue': retry primary with feedback appended
          previousVerifyText = verifyText;
          currentTask = this.taskWithFeedback(currentTask, verifyText);
          primary = await this.executor.run(currentTask, agentId, projectPath);

          if (!primary.success) {
            convergedReason = 'max-iterations';
            break;
          }

          verify = await this.runStage('verify', task, primary.output, capability);

          if (verify.status !== 'ok' || verify.output === undefined) {
            convergedReason = 'max-iterations';
            break;
          }

          if (this.isVerifyPassing(verify.output)) {
            convergedReason = 'verified';
            break;
          }
        }
      }
    }

    return {
      taskId: task.id,
      agentId,
      success: true,
      primary,
      review,
      verify,
      summary: this.buildSummary(primary.output, review, verify),
      durationMs: Date.now() - start,
      iterations,
      convergedReason,
    };
  }

  /** Returns true if verify output contains VERIFIED (but not UNVERIFIED). */
  private isVerifyPassing(output: string): boolean {
    // UNVERIFIED contains "VERIFIED" so check UNVERIFIED first
    const upper = output.toUpperCase();
    return upper.includes('VERIFIED') && !upper.includes('UNVERIFIED');
  }

  /** Maps verify text output to a RalphLoop Feedback object. */
  private verifyOutputToFeedback(output: string): {
    testCount: number;
    lintErrors: number;
    buildSuccess: boolean;
    coveragePct: number;
    timestamp: Date;
  } {
    const upper = output.toUpperCase();
    const isVerified = upper.includes('VERIFIED') && !upper.includes('UNVERIFIED');
    const isPartial = upper.includes('PARTIALLY_VERIFIED');
    return {
      buildSuccess: isVerified,
      lintErrors: isVerified || isPartial ? 0 : 1,
      testCount: isVerified ? 1 : 0,
      coveragePct: isVerified ? 100 : isPartial ? 50 : 0,
      timestamp: new Date(),
    };
  }

  /** Returns a shallow-cloned task with feedback appended to message content. */
  private taskWithFeedback(task: QueuedTask, feedback: string): QueuedTask {
    const truncated = truncateForPrompt(feedback, 500);
    return {
      ...task,
      message: {
        ...task.message,
        content: [
          task.message.content,
          '',
          '---',
          'Previous verification feedback (address these issues):',
          truncated,
        ].join('\n'),
      },
    };
  }

  private async runStage(
    role: 'review' | 'verify',
    task: QueuedTask,
    primaryOutput: string,
    capability: Capability,
  ): Promise<StageResult> {
    const truncated = truncateForPrompt(primaryOutput);
    const prompt = role === 'review'
      ? this.reviewPrompt(task.message.content, truncated)
      : this.verifyPrompt(task.message.content, truncated);

    try {
      const result = await withTimeout(
        this.modelRouter.run(capability, prompt, role),
        STAGE_TIMEOUT_MS,
        `${role} stage`,
      );
      logger.info(`MultiStageOrchestrator: ${role} ok`, { taskId: task.id, model: result.model });
      return { status: 'ok', model: result.model, output: result.output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('timed out');
      logger.warn(`MultiStageOrchestrator: ${role} ${isTimeout ? 'timeout' : 'error'}`, {
        taskId: task.id,
        err: msg,
      });
      return {
        status: isTimeout ? 'timeout' : 'error',
        error: msg,
      };
    }
  }

  private reviewPrompt(taskContent: string, truncatedOutput: string): string {
    return [
      `Review the following output for the task: "${truncateForPrompt(taskContent, 300)}"`,
      '',
      'Output to review (may be truncated):',
      truncatedOutput,
      '',
      'Assess: correctness, completeness, quality.',
      'Conclude with one of: PASS / NEEDS_IMPROVEMENT / FAIL',
    ].join('\n');
  }

  private verifyPrompt(taskContent: string, truncatedOutput: string): string {
    return [
      `Independently verify this result for the task: "${truncateForPrompt(taskContent, 300)}"`,
      '',
      'Result to verify (may be truncated):',
      truncatedOutput,
      '',
      'Check: factual accuracy, logical consistency, completeness.',
      'Conclude with one of: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED',
    ].join('\n');
  }

  private buildSummary(
    primaryOutput: string,
    review: StageResult,
    verify: StageResult,
  ): string {
    const parts: string[] = [primaryOutput];

    if (review.status === 'ok' && review.output) {
      parts.push(`\n---\n**Review (${review.model}):**\n${review.output}`);
    } else if (review.status !== 'skipped') {
      parts.push(`\n---\n**Review:** ${review.status}${review.error ? ` — ${review.error}` : ''}`);
    }

    if (verify.status === 'ok' && verify.output) {
      parts.push(`\n---\n**Verify (${verify.model}):**\n${verify.output}`);
    } else if (verify.status !== 'skipped') {
      parts.push(`\n---\n**Verify:** ${verify.status}${verify.error ? ` — ${verify.error}` : ''}`);
    }

    return parts.join('\n');
  }
}
