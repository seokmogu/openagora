import { spawn } from 'node:child_process';
import type { QueuedTask } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { CircuitBreakerRegistry } from '../health/circuit-breaker.js';
import { ProcessWatcher } from '../health/process-watcher.js';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per task

export interface ExecutionResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output: string;
  durationMs: number;
}

export class AgentExecutor {
  constructor(private readonly processWatcher: ProcessWatcher) {}

  /** Run a queued task using the specified agent via claude CLI subprocess. */
  async run(task: QueuedTask, agentId: string, projectPath: string): Promise<ExecutionResult> {
    const breaker = CircuitBreakerRegistry.get(agentId);
    const startMs = Date.now();

    if (breaker.isOpen()) {
      logger.warn('Circuit open for agent, rejecting task', { agentId, taskId: task.id });
      return {
        taskId: task.id,
        agentId,
        success: false,
        output: `Circuit breaker OPEN for agent ${agentId}. Task rejected.`,
        durationMs: Date.now() - startMs,
      };
    }

    const prompt = this.buildPrompt(task, agentId);

    try {
      logger.info('AgentExecutor: spawning claude', { taskId: task.id, agentId, projectPath });
      const output = await this.spawnClaude(prompt, agentId, projectPath, task.id);
      breaker.recordSuccess();

      return {
        taskId: task.id,
        agentId,
        success: true,
        output,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      breaker.recordFailure();
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('AgentExecutor: task failed', { taskId: task.id, agentId, err: msg });

      return {
        taskId: task.id,
        agentId,
        success: false,
        output: msg,
        durationMs: Date.now() - startMs,
      };
    }
  }

  private buildPrompt(task: QueuedTask, agentId: string): string {
    const { content, channel, userId } = task.message;
    return [
      `You are acting as the ${agentId} for this project.`,
      `Channel: ${channel} | User: ${userId}`,
      ``,
      `Task:`,
      content,
    ].join('\n');
  }

  private spawnClaude(
    prompt: string,
    agentId: string,
    projectPath: string,
    taskId: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use --agent flag so claude loads the right sub-agent definition
      const args = ['-p', '--agent', agentId, '--dangerously-skip-permissions', prompt];

      const child = spawn('claude', args, {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        detached: true, // allows process group kill
      });

      if (!child.pid) {
        reject(new Error('Failed to spawn claude process'));
        return;
      }

      this.processWatcher.register(child.pid, taskId);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        logger.warn('AgentExecutor: task timeout, killing process group', { taskId, pid: child.pid });
        try {
          // Kill entire process group to prevent zombies (P2/P3)
          process.kill(-(child.pid as number), 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        reject(new Error(`Task ${taskId} timed out after ${TIMEOUT_MS / 1000}s`));
      }, TIMEOUT_MS);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (child.pid) this.processWatcher.unregister(child.pid);

        if (code !== 0) {
          reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(stdout.trim());
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (child.pid) this.processWatcher.unregister(child.pid);
        reject(err);
      });
    });
  }

  /** Detect domain from message content using keyword matching. */
  static detectDomain(content: string): import('../types/index.js').DomainType {
    const lower = content.toLowerCase();

    const patterns: Array<[import('../types/index.js').DomainType, RegExp]> = [
      ['database', /\b(sql|schema|query|migration|postgres|mysql|mongodb|redis|db|database|table|index)\b/],
      ['research',  /\b(research|study|survey|literature|paper|academic|review|search|find|investigate)\b/],
      ['writing',   /\b(write|draft|essay|article|document|blog|report|paper|논문|작성)\b/],
      ['analysis',  /\b(analyz|analyse|data|stat|metric|insight|visualiz|chart|graph|trend)\b/],
      ['planning',  /\b(plan|roadmap|milestone|task|schedule|backlog|sprint|timeline|require)\b/],
      ['development', /\b(code|implement|build|develop|function|class|api|bug|fix|refactor|test)\b/],
    ];

    for (const [domain, pattern] of patterns) {
      if (pattern.test(lower)) return domain;
    }

    return 'general';
  }
}
