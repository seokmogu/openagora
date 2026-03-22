import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const TREES_DIR = '.trees';

/** Manages git worktrees for task isolation (P4 fix). */
export class WorktreeManager {
  /** Returns the worktree path for a task. */
  static getPath(projectPath: string, taskId: string): string {
    return join(projectPath, TREES_DIR, `task-${taskId}`);
  }

  /**
   * Creates a git worktree for the task.
   * Returns the worktree path on success, or null if the project is not a git
   * repo or worktree creation fails (caller falls back to projectPath).
   */
  static async create(projectPath: string, taskId: string): Promise<string | null> {
    const worktreePath = WorktreeManager.getPath(projectPath, taskId);
    try {
      await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, 'HEAD'], {
        cwd: projectPath,
      });
      logger.info('WorktreeManager: created', { taskId, worktreePath });
      return worktreePath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('WorktreeManager: create failed, using project dir', { taskId, err: msg });
      return null;
    }
  }

  /**
   * Removes the git worktree for a task. Best-effort — logs but does not throw.
   */
  static async remove(projectPath: string, taskId: string): Promise<void> {
    const worktreePath = WorktreeManager.getPath(projectPath, taskId);
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: projectPath,
      });
      logger.info('WorktreeManager: removed', { taskId, worktreePath });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('WorktreeManager: remove failed', { taskId, err: msg });
    }
  }
}
