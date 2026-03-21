import type { DomainType, Capability } from '../types/index.js';
import type { AgentExecutor, ExecutionResult } from '../agents/executor.js';
import type { QueuedTask } from '../types/index.js';
import { ModelRouter } from './router.js';
import { logger } from '../utils/logger.js';

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
    const primary = await this.executor.run(task, agentId, projectPath);

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
      };
    }

    // Stage 2: Review (e.g. codex) — best-effort with timeout
    const review: StageResult = route.review
      ? await this.runStage('review', task, primary.output, capability)
      : { status: 'skipped' };

    // Stage 3: Verify (e.g. gemini) — best-effort with timeout
    const verify: StageResult = route.verify
      ? await this.runStage('verify', task, primary.output, capability)
      : { status: 'skipped' };

    return {
      taskId: task.id,
      agentId,
      success: true,
      primary,
      review,
      verify,
      summary: this.buildSummary(primary.output, review, verify),
      durationMs: Date.now() - start,
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
