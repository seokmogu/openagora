import { spawn } from 'node:child_process';
import type { QueuedTask } from '../types/index.js';
import { homeDir } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import { CircuitBreakerRegistry } from '../health/circuit-breaker.js';
import { ProcessWatcher } from '../health/process-watcher.js';
import { WorktreeManager } from '../health/worktree.js';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per task
const PROGRESS_THROTTLE_MS = 5000; // minimum interval between progress callbacks

/** Callback invoked with short status updates during agent execution. */
export type ProgressCallback = (status: string) => void;

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
  async run(task: QueuedTask, agentId: string, projectPath: string, onProgress?: ProgressCallback): Promise<ExecutionResult> {
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
      const output = await this.spawnClaude(prompt, agentId, projectPath, task.id, onProgress);
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

  private async spawnClaude(
    prompt: string,
    agentId: string,
    projectPath: string,
    taskId: string,
    onProgress?: ProgressCallback,
  ): Promise<string> {
    // Create isolated worktree for this task (P4 fix)
    const worktreePath = await WorktreeManager.create(projectPath, taskId);
    const cwd = worktreePath ?? projectPath;

    try {
      return await this.spawnClaudeInDir(prompt, agentId, cwd, taskId, onProgress);
    } finally {
      if (worktreePath) {
        await WorktreeManager.remove(projectPath, taskId);
      }
    }
  }

  private spawnClaudeInDir(
    prompt: string,
    agentId: string,
    cwd: string,
    taskId: string,
    onProgress?: ProgressCallback,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Use --agent flag so claude loads the right sub-agent definition
      const args = ['-p', '--agent', agentId, '--dangerously-skip-permissions', prompt];

      const child = spawn('claude', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: process.env['HOME'] ?? homeDir(),
          USER: process.env['USER'] ?? '',
          SHELL: process.env['SHELL'] ?? '',
          LANG: process.env['LANG'] ?? '',
          TERM: process.env['TERM'] ?? '',
          TMPDIR: process.env['TMPDIR'] ?? '',
          NODE_ENV: process.env['NODE_ENV'] ?? 'production',
          XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'] ?? '',
          ...(process.env['ANTHROPIC_API_KEY'] ? { ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] } : {}),
          ...(process.env['CLAUDE_CODE_MAX_TURNS'] ? { CLAUDE_CODE_MAX_TURNS: process.env['CLAUDE_CODE_MAX_TURNS'] } : {}),
          ...(process.env['HTTP_PROXY'] ? { HTTP_PROXY: process.env['HTTP_PROXY'] } : {}),
          ...(process.env['HTTPS_PROXY'] ? { HTTPS_PROXY: process.env['HTTPS_PROXY'] } : {}),
          ...(process.env['NO_PROXY'] ? { NO_PROXY: process.env['NO_PROXY'] } : {}),
        },
        detached: true, // allows process group kill
      });

      // settled guard — prevent double-resolve/reject from timer + close races
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.pid) this.processWatcher.unregister(child.pid);
        fn();
      };

      // Attach all listeners BEFORE checking pid to avoid spawn error races
      let stdout = '';
      let stderr = '';
      let lastProgressTime = 0;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();

        if (onProgress) {
          const now = Date.now();
          if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
            lastProgressTime = now;
            const status = extractProgress(stdout);
            if (status) {
              onProgress(status);
            }
          }
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        logger.warn('AgentExecutor: task timeout, killing process group', { taskId, pid: child.pid });
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        settle(() => reject(new Error(`Task ${taskId} timed out after ${TIMEOUT_MS / 1000}s`)));
      }, TIMEOUT_MS);

      child.on('error', (err) => {
        settle(() => reject(err));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          settle(() => reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`)));
        } else {
          settle(() => resolve(stdout.trim()));
        }
      });

      // Check pid only after listeners are attached
      if (!child.pid) {
        settle(() => reject(new Error('Failed to spawn claude process')));
        return;
      }

      this.processWatcher.register(child.pid, taskId);
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

/** Extract a short progress status from claude CLI output. */
function extractProgress(output: string): string | null {
  const lines = output.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  // Get the last few meaningful lines
  const recent = lines.slice(-5);

  for (let i = recent.length - 1; i >= 0; i--) {
    const line = recent[i]!.trim();

    // Detect tool usage patterns
    if (/\b(Read|Write|Edit|Bash|Grep|Glob|Agent|WebSearch|WebFetch)\b/.test(line)) {
      return line.length > 150 ? line.slice(0, 147) + '...' : line;
    }

    // Detect thinking/reasoning indicators
    if (line.length > 20 && line.length < 200) {
      return line;
    }
  }

  return `Processing... (${lines.length} lines output)`;
}
