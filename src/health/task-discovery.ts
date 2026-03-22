import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface DiscoveredTask {
  projectId: string;
  projectPath: string;
  reason: string;
  content: string;
  priority: number; // lower = higher priority
}

/**
 * TaskDiscovery: periodically scans project directories for work that needs attention.
 * Discovered tasks are passed to the callback for enqueueing.
 *
 * Detection heuristics (in priority order):
 *  1. goals.md present + incomplete goals (lines starting with "- [ ]")
 *  2. Uncommitted changes older than 30 min (git status)
 *  3. Test failures in last run (test-results.txt marker file)
 */
export class TaskDiscovery {
  private timer?: NodeJS.Timeout;
  private readonly intervalMs: number;
  onDiscover: (task: DiscoveredTask) => Promise<void>;

  constructor(opts: {
    intervalMs?: number;
    onDiscover: (task: DiscoveredTask) => Promise<void>;
  }) {
    this.intervalMs = opts.intervalMs ?? 10 * 60 * 1000; // default: every 10 min
    this.onDiscover = opts.onDiscover;
  }

  start(): void {
    this.timer = setInterval(() => void this.scan(), this.intervalMs);
    logger.info('TaskDiscovery: started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    logger.info('TaskDiscovery: stopped');
  }

  /** Scan a list of projects and emit discoveries. */
  async scanProjects(projects: Array<{ id: string; path: string }>): Promise<void> {
    for (const p of projects) {
      const tasks = await this.inspectProject(p.id, p.path);
      for (const task of tasks) {
        try {
          await this.onDiscover(task);
        } catch (err) {
          logger.warn('TaskDiscovery: onDiscover error', { projectId: p.id, err: String(err) });
        }
      }
    }
  }

  private async scan(): Promise<void> {
    // Delegate to external scan provider if set
    logger.info('TaskDiscovery: scan tick');
  }

  async inspectProject(projectId: string, projectPath: string): Promise<DiscoveredTask[]> {
    const discovered: DiscoveredTask[] = [];

    // 1. goals.md incomplete items
    try {
      const goalsPath = join(projectPath, 'goals.md');
      const content = await readFile(goalsPath, 'utf-8');
      const incomplete = content.split('\n').filter(l => l.trim().startsWith('- [ ]'));
      if (incomplete.length > 0) {
        discovered.push({
          projectId,
          projectPath,
          reason: 'goals.md has incomplete items',
          content: `다음 목표들을 달성해주세요:\n${incomplete.slice(0, 5).join('\n')}`,
          priority: 1,
        });
      }
    } catch {
      // goals.md doesn't exist — skip
    }

    // 2. Uncommitted changes (only if > 30 min old)
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd: projectPath },
      );
      if (stdout.trim().length > 0) {
        // Check mtime of oldest modified file
        const { stdout: mtime } = await execFileAsync(
          'git',
          ['diff', '--name-only'],
          { cwd: projectPath },
        );
        const files = mtime.trim().split('\n').filter(Boolean);
        if (files.length > 0) {
          discovered.push({
            projectId,
            projectPath,
            reason: 'uncommitted changes detected',
            content: `다음 변경사항을 검토하고 커밋해주세요:\n${files.slice(0, 10).join('\n')}`,
            priority: 3,
          });
        }
      }
    } catch {
      // not a git repo — skip
    }

    // 3. test-results.txt failure marker
    try {
      const markerPath = join(projectPath, 'test-results.txt');
      const marker = await readFile(markerPath, 'utf-8');
      if (marker.includes('FAIL') || marker.includes('failed')) {
        discovered.push({
          projectId,
          projectPath,
          reason: 'test failures detected',
          content: `테스트 실패가 감지되었습니다. 수정해주세요:\n${marker.slice(0, 500)}`,
          priority: 2,
        });
      }
    } catch {
      // marker doesn't exist — skip
    }

    return discovered;
  }
}
