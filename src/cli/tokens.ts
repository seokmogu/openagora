import readline from 'readline';
import { readEnv, setEnvVar, removeEnvVar } from './env-manager.js';

export interface TokenDef {
  adapter: string;
  label: string;
  envKey: string;
  required: boolean;
  description: string;
  masked: boolean;
}

export const TOKEN_DEFINITIONS: TokenDef[] = [
  {
    adapter: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    required: true,
    description: 'Anthropic API key for agent execution (sk-ant-...)',
    masked: true,
  },
  {
    adapter: 'discord',
    label: 'Discord',
    envKey: 'DISCORD_BOT_TOKEN',
    required: true,
    description: 'Discord bot token from Discord Developer Portal',
    masked: true,
  },
  {
    adapter: 'slack',
    label: 'Slack Bot Token',
    envKey: 'SLACK_BOT_TOKEN',
    required: true,
    description: 'Slack bot token (xoxb-...)',
    masked: true,
  },
  {
    adapter: 'slack',
    label: 'Slack App Token',
    envKey: 'SLACK_APP_TOKEN',
    required: true,
    description: 'Slack app-level token for Socket Mode (xapp-...)',
    masked: true,
  },
  {
    adapter: 'telegram',
    label: 'Telegram',
    envKey: 'TELEGRAM_BOT_TOKEN',
    required: true,
    description: 'Telegram bot token from @BotFather',
    masked: true,
  },
  {
    adapter: 'github',
    label: 'GitHub',
    envKey: 'GITHUB_TOKEN',
    required: true,
    description: 'GitHub personal access token',
    masked: true,
  },
  {
    adapter: 'webhook',
    label: 'Webhook Secret',
    envKey: 'WEBHOOK_SECRET',
    required: false,
    description: 'Secret for webhook signature verification (optional)',
    masked: true,
  },
];

function maskValue(value: string): string {
  if (!value || value.trim() === '') return '(not set)';
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

export function listTokens(): void {
  const env = readEnv();
  const colW = [10, 20, 22, 12];
  const header = [
    'Adapter'.padEnd(colW[0]),
    'Key'.padEnd(colW[1]),
    'Value'.padEnd(colW[2]),
    'Required'.padEnd(colW[3]),
  ].join('  ');
  const separator = '-'.repeat(header.length);

  console.log('\nConfigured Tokens');
  console.log(separator);
  console.log(header);
  console.log(separator);

  for (const def of TOKEN_DEFINITIONS) {
    const raw = env[def.envKey] ?? '';
    const masked = maskValue(raw);
    console.log(
      [
        def.adapter.padEnd(colW[0]),
        def.envKey.padEnd(colW[1]),
        masked.padEnd(colW[2]),
        (def.required ? 'yes' : 'no').padEnd(colW[3]),
      ].join('  '),
    );
  }
  console.log(separator);
  console.log();
}

function askLine(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function addToken(adapter?: string): Promise<void> {
  const defs = adapter
    ? TOKEN_DEFINITIONS.filter((d) => d.adapter === adapter)
    : TOKEN_DEFINITIONS;

  if (defs.length === 0) {
    console.error(`Unknown adapter: ${adapter}`);
    console.error(
      `Available: ${[...new Set(TOKEN_DEFINITIONS.map((d) => d.adapter))].join(', ')}`,
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (const def of defs) {
      console.log(`\n[${def.label}] ${def.description}`);
      const answer = await askLine(rl, `Enter ${def.envKey}: `);
      const value = answer.trim();
      if (value !== '') {
        setEnvVar(def.envKey, value);
        console.log(`  Saved ${def.envKey}`);
      } else {
        console.log(`  Skipped ${def.envKey}`);
      }
    }
  } finally {
    rl.close();
  }
}

export function removeToken(adapter?: string): void {
  const defs = adapter
    ? TOKEN_DEFINITIONS.filter((d) => d.adapter === adapter)
    : TOKEN_DEFINITIONS;

  if (defs.length === 0) {
    console.error(`Unknown adapter: ${adapter}`);
    process.exit(1);
  }

  for (const def of defs) {
    removeEnvVar(def.envKey);
    console.log(`Removed ${def.envKey}`);
  }
}
