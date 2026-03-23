# OpenAgora Dependencies

## Runtime Dependencies (13 packages)

### Channel Communication (5 packages)

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `@slack/bolt` | ^3.22.0 | Slack Bot API | SlackAdapter integration |
| `discord.js` | ^14.16.0 | Discord Bot API | DiscordAdapter integration |
| `telegraf` | ^4.16.0 | Telegram Bot API | TelegramAdapter integration |
| `nodemailer` | ^8.0.3 | Email sending (SMTP) | EmailAdapter outbound |
| `imapflow` | ^1.2.16 | Email polling (IMAP) | EmailAdapter inbound |

### HTTP & Web (2 packages)

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `express` | ^4.21.0 | HTTP server framework | WebhookAdapter, health endpoint |
| `@types/express` | ^4.17.0 | TypeScript types | Express type safety |

### Data & Configuration (4 packages)

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `yaml` | ^2.6.0 | YAML parsing/serialization | config.yaml parsing |
| `zod` | ^3.24.0 | Runtime schema validation | Config validation |
| `dotenv` | ^16.4.0 | Environment variable loading | .env file support |
| `simple-git` | ^3.27.0 | Git CLI wrapper | Worktree management |

### Utilities (2 packages)

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `winston` | ^3.17.0 | Structured logging | Application logging |
| `p-queue` | ^8.0.0 | Promise queue | Task prioritization |

## Development Dependencies (8 packages)

### TypeScript & Compilation (3 packages)

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.0 | Language compiler |
| `tsx` | ^4.19.0 | TypeScript executor for Node.js |
| `@types/node` | ^20.17.0 | Node.js type definitions |

### Linting & Formatting (3 packages)

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | ^8.57.0 | Linting |
| `@typescript-eslint/eslint-plugin` | ^6.21.0 | TypeScript ESLint rules |
| `@typescript-eslint/parser` | ^6.21.0 | TypeScript ESLint parser |

### Testing (2 packages)

| Package | Version | Purpose |
|---------|---------|---------|
| `vitest` | ^4.1.0 | Unit testing framework |
| `@vitest/coverage-v8` | ^4.1.0 | Code coverage reporting |

### Email Types (1 package)

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/nodemailer` | ^7.0.11 | Nodemailer TypeScript types |

## Internal Module Dependency Graph

### Layer 1: Foundation (No dependencies within project)

```
types/                      (no internal deps)
  ↓ (provides types to all)
utils/logger.ts            (no internal deps except types)
config/loader.ts           (depends on types, dotenv, yaml, zod)
```

### Layer 2: Channel Adapters (Foundation + RouterMessage callback)

```
adapters/
  ├── base.ts              (types, utils/logger)
  ├── slack.ts             (@slack/bolt, types, utils/logger)
  ├── discord.ts           (discord.js, types, utils/logger)
  ├── telegram.ts          (telegraf, types, utils/logger)
  ├── email.ts             (nodemailer, imapflow, types, utils/logger)
  ├── webhook.ts           (express, types, utils/logger)
  ├── cli.ts               (types, utils/logger)
  └── manager.ts           (all above + config, types, utils/logger)
```

### Layer 3: Infrastructure (Types + Utils)

```
queue/
  └── project-queue.ts     (types, utils/logger)

health/
  ├── circuit-breaker.ts   (types, utils/logger)
  ├── process-watcher.ts   (types, utils/logger, simple-git)
  ├── worktree.ts          (types, utils/logger, simple-git)
  ├── health-monitor.ts    (types, utils/logger)
  ├── ralph-loop.ts        (types, utils/logger)
  ├── notifier.ts          (types, utils/logger)
  ├── task-discovery.ts    (types, utils/logger)
  └── daemon.ts            (all health/* above, config, express, types, utils/logger)
```

### Layer 4: Agent Execution (Infrastructure + Types)

```
agents/
  ├── registry.ts          (types, utils/logger, simple-git)
  ├── executor.ts          (types, utils/logger, health/circuit-breaker, health/process-watcher, health/worktree)
  ├── p2p-router.ts        (types, utils/logger, agents/executor, agents/registry)
  └── builder-agent.ts     (types, utils/logger)
```

### Layer 5: Model Orchestration (Agent Execution)

```
models/
  ├── router.ts            (types, utils/logger)
  └── multi-stage.ts       (types, utils/logger, agents/executor, health/ralph-loop, agents/p2p-router, models/router)
```

### Layer 6: Routing & Dispatch (All layers)

```
router/
  ├── registry.ts          (types, utils/logger)
  ├── command-parser.ts    (types, utils/logger)
  ├── project-creator.ts   (types, utils/logger, router/registry)
  └── project-router.ts    (types, utils/logger, all of: queue, agents, models, health, router/*, config)
```

### Layer 7: Entry Points (Top-level integration)

```
index.ts                   (config, adapters/manager, router/project-router, health/daemon, utils/logger)

cli/
  ├── main.ts              (config, router/project-router, utils/logger)
  ├── setup.ts             (types, utils/logger, config)
  ├── tokens.ts            (types, utils/logger)
  └── env-manager.ts       (dotenv, types, utils/logger)
```

## Circular Dependency Analysis

**No circular dependencies detected** (verified by import tree acyclicity).

Key safeguards:
- `HealthDaemon` owns `ProcessWatcher` (one-way dependency)
- `ProjectRouter` imports from all layers but nothing imports `ProjectRouter` except index.ts and CLI
- `AgentExecutor` depends on health but health doesn't depend on agents
- Types are centralized in `types/index.ts` and never import from modules

## Version Constraints

### Production Stability

- **TypeScript 5.7+**: Strict mode enabled, ESM support required
- **Node.js 22 LTS**: ESM modules mandatory (no CommonJS)
- **Package versions locked**: No minor version ranges (e.g., `^5.7.0` becomes `5.7.x`)

### Development Tooling

- **Vitest 4.1+**: Modern unit testing
- **ESLint 8.57+**: Latest linting with TypeScript support
- **tsx 4.19+**: Fast TypeScript execution for development

## Installation & Build

### Install Production Dependencies

```bash
npm install
```

Installs all packages listed in `dependencies` (13 packages).

### Install All Dependencies (with dev tools)

```bash
npm install --save-dev
```

Installs both `dependencies` and `devDependencies` (21 packages total).

### Build

```bash
npm run build
```

Runs `tsc` to compile TypeScript to `dist/` directory.

Output: ESM JavaScript with source maps and type declarations (.d.ts files).

### Development Mode

```bash
npm run dev
```

Runs `tsx watch src/index.ts` for live reloading.

### Testing

```bash
npm run test                   # Run all tests once
npm run test:watch            # Run tests in watch mode
npm run coverage              # Generate coverage report
```

### Linting

```bash
npm run lint
npm run typecheck            # Type-only checking (tsc --noEmit)
```

## External API Versions

### Claude API (via CLI subprocess)

- **Claude CLI binary**: Required in PATH
- **API Version**: Latest Claude models (configurable per domain/capability)
- **Authentication**: CLAUDE_API_KEY environment variable

### GitHub API (via simple-git)

- **Usage**: Worktree operations (git worktree add/remove)
- **Authentication**: Via local git config (SSH keys or credentials)
- **Version**: Git 2.34+ required

## Dependency Vulnerability Scanning

Run periodic audits:

```bash
npm audit                     # List vulnerabilities
npm audit fix                 # Auto-fix compatible vulnerabilities
npm audit fix --force         # Force upgrades (may break compatibility)
```

### Known Safe Updates

Monitor for updates via `npm outdated`:

```bash
npm outdated                  # List packages with newer versions available
```

## Dependency Size Impact

### Total Size Analysis

- **Production bundle**: ~45 MB (node_modules with all dependencies)
- **Compiled output**: ~2 MB (dist/ with minification)
- **Docker image**: ~180 MB (Node.js 22 + dependencies)

### Largest Packages by Size

1. `discord.js` - 2.8 MB (native dependencies)
2. `@slack/bolt` - 1.5 MB
3. `imapflow` - 0.8 MB
4. `telegraf` - 0.7 MB
5. `simple-git` - 0.5 MB

### Size Optimization Opportunities

- Split channel adapters into optional packages (lazy loading)
- Tree-shake unused Winston transports
- Consider lightweight alternatives to some adapters

## Security Considerations

### Secrets Management

- **NEVER commit**: `.env`, `.env.local`, API keys
- **Load via environment**: `dotenv` loads from `.env` at runtime (dev only)
- **Production**: Use environment variables directly (no .env file)

### Dependency Audit

- Run `npm audit` before production deployments
- Enable automated dependency updates via GitHub Dependabot
- Review changelogs for breaking changes in major versions

### Safe Defaults

- All third-party inputs validated via Zod schemas
- SQL injection N/A (no database access in current scope)
- CSRF N/A (no user sessions in current scope)
- XSS N/A (no rendering of user content)
