import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ENV_PATH = resolve(process.cwd(), '.env');

interface EnvLine {
  raw: string;
  key?: string;
  value?: string;
  isComment: boolean;
  isBlank: boolean;
}

function parseEnvFile(content: string): EnvLine[] {
  return content.split('\n').map((raw) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { raw, isComment: false, isBlank: true };
    }
    if (trimmed.startsWith('#')) {
      return { raw, isComment: true, isBlank: false };
    }
    const eqIdx = raw.indexOf('=');
    if (eqIdx === -1) {
      return { raw, isComment: false, isBlank: false };
    }
    const key = raw.slice(0, eqIdx).trim();
    const value = raw.slice(eqIdx + 1);
    return { raw, key, value, isComment: false, isBlank: false };
  });
}

function serializeLines(lines: EnvLine[]): string {
  return lines.map((l) => l.raw).join('\n');
}

export function readEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const content = readFileSync(ENV_PATH, 'utf-8');
  const lines = parseEnvFile(content);
  const result: Record<string, string> = {};
  for (const line of lines) {
    if (line.key !== undefined && line.value !== undefined) {
      result[line.key] = line.value;
    }
  }
  return result;
}

export function getEnvVar(key: string): string | undefined {
  const env = readEnv();
  return env[key];
}

export function setEnvVar(key: string, value: string): void {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  // Ensure content ends with newline for consistent parsing
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }
  const lines = parseEnvFile(content);
  const idx = lines.findIndex((l) => l.key === key);
  const newLine: EnvLine = {
    raw: `${key}=${value}`,
    key,
    value,
    isComment: false,
    isBlank: false,
  };
  if (idx !== -1) {
    lines[idx] = newLine;
  } else {
    lines.push(newLine);
  }
  writeFileSync(ENV_PATH, serializeLines(lines), 'utf-8');
}

export function removeEnvVar(key: string): void {
  if (!existsSync(ENV_PATH)) return;
  const content = readFileSync(ENV_PATH, 'utf-8');
  const lines = parseEnvFile(content);
  const filtered = lines.filter((l) => l.key !== key);
  writeFileSync(ENV_PATH, serializeLines(filtered), 'utf-8');
}
