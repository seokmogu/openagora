import readline from 'readline';
import { readEnv, setEnvVar } from './env-manager.js';
import { TOKEN_DEFINITIONS } from './tokens.js';

function ask(rl: readline.Interface, question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal !== undefined ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed !== '' ? trimmed : (defaultVal ?? ''));
    });
  });
}

function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`${question} (${hint}): `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') resolve(defaultYes);
      else resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

export async function runSetup(): Promise<void> {
  const env = readEnv();
  const configured = TOKEN_DEFINITIONS.filter(
    (d) => env[d.envKey] && env[d.envKey].trim() !== '',
  );

  console.log('\n========================================');
  console.log('  OpenAgora - Setup Wizard');
  console.log('========================================\n');

  // Check Claude CLI
  let claudeOk = false;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('claude', ['--version'], { stdio: 'pipe' });
    claudeOk = true;
    console.log('  [OK] Claude CLI detected\n');
  } catch {
    console.log('  [!!] Claude CLI not found');
    console.log('  Install: https://docs.anthropic.com/en/docs/claude-code\n');
  }

  if (configured.length > 0) {
    console.log(`  Found ${configured.length} token(s) already configured:\n`);
    for (const def of configured) {
      console.log(`    - ${def.envKey} (${def.label})`);
    }
    console.log();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Quick Start vs Full Setup
    console.log('  1. Quick Start (CLI only) - No tokens needed');
    console.log('  2. Full Setup - Configure channel integrations\n');

    const choice = await ask(rl, 'Choose setup mode (1 or 2)', '1');

    if (choice === '1') {
      console.log('\n========================================');
      console.log('  Quick Start Complete!');
      console.log('========================================\n');
      if (claudeOk) {
        console.log('  You are ready to go. Run:\n');
        console.log('    npm run build');
        console.log('    npm start\n');
        console.log('  OpenAgora will start in CLI mode.');
        console.log('  Type your task directly in the terminal.\n');
      } else {
        console.log('  Please install Claude CLI first, then run:\n');
        console.log('    npm run build');
        console.log('    npm start\n');
      }
      return;
    }

    // Full Setup - group by adapter
    const adapters = [...new Set(TOKEN_DEFINITIONS.map((d) => d.adapter))];
    const saved: string[] = [];

    for (const adapter of adapters) {
      const defs = TOKEN_DEFINITIONS.filter((d) => d.adapter === adapter);
      const adapterLabel = defs[0].label.replace(/ (Bot Token|App Token)$/, '');

      console.log(`\n--- ${adapterLabel} (optional) ---`);
      const alreadySet = defs.some((d) => env[d.envKey] && env[d.envKey].trim() !== '');
      const prompt = alreadySet
        ? `Configure ${adapterLabel} (already set, overwrite)?`
        : `Configure ${adapterLabel}?`;

      const configure = await askYesNo(rl, prompt, false);
      if (!configure) {
        console.log(`  Skipped ${adapterLabel}`);
        continue;
      }

      for (const def of defs) {
        console.log(`  ${def.description}`);
        const value = await ask(rl, `  ${def.envKey}`);
        if (value !== '') {
          setEnvVar(def.envKey, value);
          saved.push(def.envKey);
        }
      }
    }

    console.log('\n========================================');
    if (saved.length > 0) {
      console.log(`  Setup complete. Saved ${saved.length} token(s):\n`);
      for (const key of saved) {
        console.log(`    - ${key}`);
      }
    } else {
      console.log('  Setup complete. No tokens were changed.');
    }
    console.log('\n  Next steps:\n');
    console.log('    npm run build');
    console.log('    npm start\n');
    console.log('========================================\n');
  } finally {
    rl.close();
  }
}
