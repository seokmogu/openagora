import type { ChannelType } from '../types/index.js';

export type CommandVerb = 'run' | 'status' | 'list' | 'help';

export interface ParsedCommand {
  verb: CommandVerb;
  projectName: string | null;
  taskDescription: string | null;
  raw: string;
}

export interface ParseError {
  error: string;
  suggestion: string;
}

export type ParseResult =
  | { ok: true; command: ParsedCommand }
  | { ok: false; error: ParseError };

// @MX:ANCHOR: Central command parsing entry point — called by all channel adapters via ProjectRouter
// @MX:REASON: [AUTO] fan_in >= 3 (discord, slack, telegram, cli adapters all route here)
export class CommandParser {
  // @MX:NOTE: [AUTO] Each channel type has distinct prefix conventions; stripping is order-sensitive
  parse(content: string, channel: string): ParseResult {
    const raw = content;
    const stripped = this.stripPrefix(content.trim(), channel as ChannelType);
    return this.parseStripped(stripped, raw);
  }

  private stripPrefix(content: string, channel: ChannelType): string {
    switch (channel) {
      case 'discord': {
        // Strip !openagora, !agora, @openagora (case-insensitive)
        const discordPrefixes = /^(?:!openagora|!agora|@openagora)\s*/i;
        return content.replace(discordPrefixes, '');
      }
      case 'slack': {
        // Strip @openagora or <@USERID> (any mention)
        const slackPrefixes = /^(?:@openagora|<@[A-Z0-9]+>)\s*/i;
        return content.replace(slackPrefixes, '');
      }
      case 'telegram': {
        // Strip /run, /status, /list, /help — but keep the verb as the first token
        // Telegram uses /verb directly, so we transform /verb → verb
        const telegramCmd = /^\/([a-z]+)\s*/i;
        const m = telegramCmd.exec(content);
        if (m) {
          return content.replace(telegramCmd, `${m[1]} `).trim();
        }
        return content;
      }
      case 'cli':
      case 'webhook': {
        // Strip leading "openagora" prefix if present
        const cliPrefix = /^openagora\s+/i;
        return content.replace(cliPrefix, '');
      }
      default:
        return content;
    }
  }

  private parseStripped(stripped: string, raw: string): ParseResult {
    const trimmed = stripped.trim();

    if (!trimmed) {
      return {
        ok: false,
        error: {
          error: 'Empty command',
          suggestion: 'Try: run <project> "<task>" or help',
        },
      };
    }

    // Tokenise respecting quoted strings
    const tokens = tokenise(trimmed);
    const firstToken = tokens[0]?.toLowerCase() ?? '';

    switch (firstToken) {
      case 'run':
        return this.parseRun(tokens.slice(1), raw);

      case 'status':
        return {
          ok: true,
          command: {
            verb: 'status',
            projectName: tokens[1] ?? null,
            taskDescription: null,
            raw,
          },
        };

      case 'list':
        return {
          ok: true,
          command: { verb: 'list', projectName: null, taskDescription: null, raw },
        };

      case 'help':
        return {
          ok: true,
          command: { verb: 'help', projectName: null, taskDescription: null, raw },
        };

      default:
        // No recognised verb — treat entire content as a run with auto-detect project
        return {
          ok: true,
          command: {
            verb: 'run',
            projectName: null,
            taskDescription: trimmed || null,
            raw,
          },
        };
    }
  }

  private parseRun(args: string[], raw: string): ParseResult {
    if (args.length === 0) {
      return {
        ok: false,
        error: {
          error: 'Missing task description for run command',
          suggestion: 'Usage: run <project> "<task description>"',
        },
      };
    }

    // First arg is projectName, rest joined is taskDescription
    const projectName = args[0] ?? null;
    const taskParts = args.slice(1);

    if (taskParts.length === 0) {
      return {
        ok: false,
        error: {
          error: 'Missing task description for run command',
          suggestion: `Usage: run ${projectName} "<task description>"`,
        },
      };
    }

    const taskDescription = taskParts.join(' ');

    return {
      ok: true,
      command: {
        verb: 'run',
        projectName,
        taskDescription,
        raw,
      },
    };
  }
}

/**
 * Tokenise a string, treating quoted substrings as single tokens (quotes stripped).
 * e.g. `run myapp "add database migration"` → ['run', 'myapp', 'add database migration']
 */
function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export const HELP_MESSAGE = `OpenAgora Commands:
  run <project> "<task>"  - Execute a task on a project
  status [project]        - Show project queue status
  list                    - List all active projects
  help                    - Show this message

Examples:
  !openagora run myapp "implement login API"
  !openagora status myapp
  !openagora list`;
