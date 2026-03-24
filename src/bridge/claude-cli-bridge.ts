import { spawn } from 'node:child_process';
import { homeDir } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import { ProcessWatcher } from '../health/process-watcher.js';

const TIMEOUT_MS = 30 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 5000;

/** Callback invoked with short status updates during claude execution. */
export type ProgressCallback = (status: string) => void;

export interface BridgeResult {
  taskId: string;
  success: boolean;
  output: string;
  durationMs: number;
}

// @MX:ANCHOR: [AUTO] Central bridge between OpenAgora and the claude CLI process
// @MX:REASON: [AUTO] Primary execution path called by ProjectRouter for all task dispatch
// @MX:SPEC: SPEC-BRIDGE-001
export class ClaudeCliBridge {
  constructor(private readonly processWatcher: ProcessWatcher) {}

  async run(
    projectPath: string,
    prompt: string,
    taskId: string,
    onProgress?: ProgressCallback,
  ): Promise<BridgeResult> {
    const startMs = Date.now();
    try {
      logger.info('ClaudeCliBridge: spawning claude', { taskId, projectPath });
      const output = await this.spawnClaude(prompt, projectPath, taskId, onProgress);
      return { taskId, success: true, output, durationMs: Date.now() - startMs };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ClaudeCliBridge: task failed', { taskId, err: msg });
      return { taskId, success: false, output: msg, durationMs: Date.now() - startMs };
    }
  }

  private spawnClaude(
    prompt: string,
    cwd: string,
    taskId: string,
    onProgress?: ProgressCallback,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', '--dangerously-skip-permissions', prompt];

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
        detached: true,
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
            if (status) onProgress(status);
          }
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        logger.warn('ClaudeCliBridge: task timeout', { taskId, pid: child.pid });
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        settle(() => reject(new Error(`Task ${taskId} timed out after ${TIMEOUT_MS / 1000}s`)));
      }, TIMEOUT_MS);

      child.on('error', (err) => settle(() => reject(err)));
      child.on('close', (code) => {
        if (code !== 0) {
          settle(() => reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`)));
        } else {
          settle(() => resolve(stdout.trim()));
        }
      });

      if (!child.pid) {
        settle(() => reject(new Error('Failed to spawn claude process')));
        return;
      }
      this.processWatcher.register(child.pid, taskId);
    });
  }
}

/** Extract a short progress status from claude CLI output. */
function extractProgress(output: string): string | null {
  const lines = output.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;
  const recent = lines.slice(-5);
  for (let i = recent.length - 1; i >= 0; i--) {
    const line = recent[i]!.trim();
    if (/\b(Read|Write|Edit|Bash|Grep|Glob|Agent|WebSearch|WebFetch)\b/.test(line)) {
      return line.length > 150 ? line.slice(0, 147) + '...' : line;
    }
    if (line.length > 20 && line.length < 200) {
      return line;
    }
  }
  return `Processing... (${lines.length} lines output)`;
}
