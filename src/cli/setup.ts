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
  console.log('  OpenAgora - First Time Setup Wizard');
  console.log('========================================\n');

  if (configured.length > 0) {
    console.log(`Found ${configured.length} token(s) already configured:\n`);
    for (const def of configured) {
      console.log(`  - ${def.envKey} (${def.label})`);
    }
    console.log();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Group by adapter
    const adapters = [...new Set(TOKEN_DEFINITIONS.map((d) => d.adapter))];
    const saved: string[] = [];

    for (const adapter of adapters) {
      const defs = TOKEN_DEFINITIONS.filter((d) => d.adapter === adapter);
      const adapterLabel = defs[0].label.replace(/ (Bot Token|App Token)$/, '');

      console.log(`\n--- ${adapterLabel} ---`);
      const alreadySet = defs.some((d) => env[d.envKey] && env[d.envKey].trim() !== '');
      const prompt = alreadySet
        ? `Configure ${adapterLabel} (already set, overwrite)?`
        : `Configure ${adapterLabel}?`;

      const configure = await askYesNo(rl, prompt, !alreadySet);
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
      console.log(`Setup complete. Saved ${saved.length} token(s):`);
      for (const key of saved) {
        console.log(`  - ${key}`);
      }
    } else {
      console.log('Setup complete. No tokens were changed.');
    }
    console.log('\nRun `openagora start` to launch the server.');
    console.log('========================================\n');
  } finally {
    rl.close();
  }
}
