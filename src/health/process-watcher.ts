import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WATCH_INTERVAL_MS = 30_000; // 30 seconds

interface WatchedProcess {
  pid: number;
  projectId: string;
  startedAt: Date;
  lastHeartbeat: Date;
  timeoutMs: number;
}

export class ProcessWatcher {
  private processes = new Map<number, WatchedProcess>();
  private watchInterval?: NodeJS.Timeout;

  register(pid: number, projectId: string, timeoutMs?: number): void {
    const now = new Date();
    this.processes.set(pid, {
      pid,
      projectId,
      startedAt: now,
      lastHeartbeat: now,
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    logger.info('Process registered', { pid, projectId, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS });
  }

  heartbeat(pid: number): void {
    const proc = this.processes.get(pid);
    if (proc) {
      proc.lastHeartbeat = new Date();
    }
  }

  unregister(pid: number): void {
    const proc = this.processes.get(pid);
    if (proc) {
      this.processes.delete(pid);
      logger.info('Process unregistered', { pid, projectId: proc.projectId });
    }
  }

  start(): void {
    if (this.watchInterval) return;
    this.watchInterval = setInterval(() => {
      this.check();
    }, WATCH_INTERVAL_MS);
    logger.info('Process watcher started', { intervalMs: WATCH_INTERVAL_MS });
  }

  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
      logger.info('Process watcher stopped');
    }
  }

  private check(): void {
    const now = Date.now();
    for (const [pid, proc] of this.processes) {
      const elapsed = now - proc.lastHeartbeat.getTime();
      if (elapsed > proc.timeoutMs) {
        logger.warn('Process timed out, killing', {
          pid,
          projectId: proc.projectId,
          elapsedMs: elapsed,
          timeoutMs: proc.timeoutMs,
        });
        this.kill(pid);
        this.processes.delete(pid);
      }
    }
  }

  private kill(pid: number): void {
    try {
      process.kill(-pid, 'SIGKILL');
      logger.info('Killed process group', { pid });
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
        logger.info('Killed process', { pid });
      } catch {
        logger.debug('Process already dead', { pid });
      }
    }
  }
}
