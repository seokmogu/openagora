import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Cross-platform utility module for OpenAgora.
 * Abstracts OS-specific paths and behaviors.
 */

/** Returns the user's home directory. Works on macOS, Linux, and Windows. */
export function homeDir(): string {
  return os.homedir();
}

/** Returns the default base project directory. */
export function defaultBaseDir(): string {
  return path.join(os.homedir(), 'project');
}

/** Returns the platform name. */
export function platform(): NodeJS.Platform {
  return os.platform();
}

/** Returns true if running on macOS. */
export function isMacOS(): boolean {
  return os.platform() === 'darwin';
}

/** Returns true if running on Linux. */
export function isLinux(): boolean {
  return os.platform() === 'linux';
}

/** Ensures a directory exists, creating it recursively if needed. */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
