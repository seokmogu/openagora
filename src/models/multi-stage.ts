import type { DomainType, Capability } from '../types/index.js';
import type { AgentExecutor, ExecutionResult } from '../agents/executor.js';
import type { QueuedTask } from '../types/index.js';
import { ModelRouter } from './router.js';
import { logger } from '../utils/logger.js';

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

export interface MultiStageResult {
  taskId: string;
  agentId: string;
  success: boolean;
  primary: ExecutionResult;
  review?: { model: string; output: string };
  verify?: { model: string; output: string };
  summary: string;
  durationMs: number;
}

/**
 * MultiStageOrchestrator runs a task through up to 3 model stages:
 *   1. Primary (claude agent) — main execution
 *   2. Review  (codex)       — quality/completeness check
 *   3. Verify  (gemini)      — independent verification
 *
 * Stages 2-3 are skipped if the capability route has no review/verify model,
 * or if the primary stage failed.
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
        summary: `Primary stage failed: ${primary.output.slice(0, 200)}`,
        durationMs: Date.now() - start,
      };
    }

    // Stage 2: Review (e.g. codex)
    let review: MultiStageResult['review'];
    if (route.review) {
      review = await this.runReview(task, primary.output, capability);
    }

    // Stage 3: Verify (e.g. gemini)
    let verify: MultiStageResult['verify'];
    if (route.verify) {
      verify = await this.runVerify(task, primary.output, capability);
    }

    const summary = this.buildSummary(primary.output, review, verify);

    return {
      taskId: task.id,
      agentId,
      success: true,
      primary,
      review,
      verify,
      summary,
      durationMs: Date.now() - start,
    };
  }

  private async runReview(
    task: QueuedTask,
    primaryOutput: string,
    capability: Capability,
  ): Promise<{ model: string; output: string } | undefined> {
    const prompt = [
      `Review the following output for a task: "${task.message.content.slice(0, 300)}"`,
      '',
      'Output to review:',
      primaryOutput.slice(0, 3000),
      '',
      'Provide a concise review focusing on: correctness, completeness, quality.',
      'Rate overall: PASS / NEEDS_IMPROVEMENT / FAIL',
    ].join('\n');

    try {
      const result = await this.modelRouter.run(capability, prompt, 'review');
      logger.info('MultiStageOrchestrator: review complete', { taskId: task.id, model: result.model });
      return { model: result.model, output: result.output };
    } catch (err) {
      logger.warn('MultiStageOrchestrator: review failed, skipping', {
        taskId: task.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  private async runVerify(
    task: QueuedTask,
    primaryOutput: string,
    capability: Capability,
  ): Promise<{ model: string; output: string } | undefined> {
    const prompt = [
      `Independently verify the following result for the task: "${task.message.content.slice(0, 300)}"`,
      '',
      'Result to verify:',
      primaryOutput.slice(0, 3000),
      '',
      'Check for factual accuracy, logical consistency, and completeness.',
      'Conclude with: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED',
    ].join('\n');

    try {
      const result = await this.modelRouter.run(capability, prompt, 'verify');
      logger.info('MultiStageOrchestrator: verify complete', { taskId: task.id, model: result.model });
      return { model: result.model, output: result.output };
    } catch (err) {
      logger.warn('MultiStageOrchestrator: verify failed, skipping', {
        taskId: task.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  private buildSummary(
    primaryOutput: string,
    review?: { model: string; output: string },
    verify?: { model: string; output: string },
  ): string {
    const parts: string[] = [primaryOutput];

    if (review) {
      parts.push(`\n---\n**Review (${review.model}):**\n${review.output}`);
    }
    if (verify) {
      parts.push(`\n---\n**Verify (${verify.model}):**\n${verify.output}`);
    }

    return parts.join('\n');
  }
}
