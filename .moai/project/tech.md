# OpenAgora Technology Stack

## Overview

OpenAgora is a Node.js application built with TypeScript in strict mode. It uses Express.js for HTTP routing, integrates with multiple external APIs (Slack, Discord, Telegram, Email, Claude, Codex, Gemini), and provides comprehensive health monitoring.

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | Node.js | 22 LTS | JavaScript execution environment |
| **Language** | TypeScript | 5.7 | Type-safe development with strict mode |
| **HTTP Server** | Express.js | 4.21 | REST API and webhook endpoints |
| **Build** | TypeScript Compiler | 5.7 | Compiles TS to ES2022 JavaScript |
| **Dev Runtime** | tsx | 4.19 | Fast TypeScript execution during development |
| **Testing** | Vitest | 4.1 | Fast unit test runner |
| **Coverage** | @vitest/coverage-v8 | 4.1 | Code coverage analysis |
| **Linting** | ESLint | 8.57 | Code quality and style |

## Channel Integrations

| Channel | Library | Version | Authentication |
|---------|---------|---------|-----------------|
| **Slack** | @slack/bolt | 3.22 | Bot token (OAuth) |
| **Discord** | discord.js | 14.16 | Bot token |
| **Telegram** | telegraf | 4.16 | Bot token |
| **Email** | nodemailer + imapflow | 8.0 + 1.2 | SMTP/IMAP credentials |
| **Webhook** | express (built-in) | 4.21 | HTTP listener |
| **CLI** | Node.js readline | 22 LTS | Interactive prompt |

## AI Model APIs

| Service | Purpose | Integration |
|---------|---------|-------------|
| **Claude (Anthropic)** | Primary agent execution | Direct API calls |
| **Codex (OpenAI)** | Code review in multi-stage pipeline | Secondary verification |
| **Gemini (Google)** | Final verification stage | Tertiary validation |

## Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.21.0 | HTTP server framework |
| `@slack/bolt` | ^3.22.0 | Slack integration |
| `discord.js` | ^14.16.0 | Discord integration |
| `telegraf` | ^4.16.0 | Telegram integration |
| `nodemailer` | ^8.0.3 | Email sending (SMTP) |
| `imapflow` | ^1.2.16 | Email receiving (IMAP) |
| `@types/nodemailer` | ^7.0.11 | TypeScript types for nodemailer |
| `p-queue` | ^8.0.0 | Promise-based task queue |
| `simple-git` | ^3.27.0 | Git operations (worktree management) |
| `winston` | ^3.17.0 | Structured logging |
| `yaml` | ^2.6.0 | YAML config parsing |
| `zod` | ^3.24.0 | Runtime type validation |
| `dotenv` | ^16.4.0 | Environment variable loading |

## Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.0 | TypeScript compiler |
| `tsx` | ^4.19.0 | TypeScript execution for development |
| `vitest` | ^4.1.0 | Test runner |
| `@vitest/coverage-v8` | ^4.1.0 | V8-based coverage |
| `eslint` | ^8.57.0 | Linting |
| `@typescript-eslint/parser` | ^6.21.0 | TS support for ESLint |
| `@typescript-eslint/eslint-plugin` | ^6.21.0 | TS ESLint rules |
| `@types/express` | ^4.17.0 | Express type definitions |
| `@types/node` | ^20.17.0 | Node.js type definitions |

## Build Configuration

### TypeScript Compiler Options (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true
  }
}
```

**Key Enforcements:**
- ES2022 target for modern JavaScript features
- Strict mode enabled (no implicit any, strict null checks)
- Declaration files generated for consumers
- Source maps for debugging
- All unused variables/parameters flagged as errors

### Build Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage"
  }
}
```

## Development Environment Requirements

### Required

- **Node.js** 22 LTS (or latest LTS version)
- **npm** 10.x or higher (or equivalent package manager: pnpm, yarn)
- **Git** 2.30 or higher (for worktree operations)

### Verification

```bash
# Check Node.js version
node --version  # Should output v22.x.x

# Check npm version
npm --version   # Should output 10.x.x

# Check Git version
git --version   # Should output 2.30+
```

## Key Environment Variables

| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| `SLACK_BOT_TOKEN` | Yes | `xoxb-...` | Slack bot authentication |
| `SLACK_SIGNING_SECRET` | Yes | `secret...` | Slack request verification |
| `DISCORD_TOKEN` | Yes | `MTA...` | Discord bot authentication |
| `TELEGRAM_BOT_TOKEN` | Yes | `123:ABC...` | Telegram bot token |
| `EMAIL_SMTP_HOST` | If email enabled | `smtp.gmail.com` | SMTP server |
| `EMAIL_SMTP_USER` | If email enabled | `user@domain.com` | SMTP username |
| `EMAIL_SMTP_PASS` | If email enabled | `password` | SMTP password |
| `IMAP_HOST` | If email enabled | `imap.gmail.com` | IMAP server |
| `IMAP_USER` | If email enabled | `user@domain.com` | IMAP username |
| `IMAP_PASS` | If email enabled | `password` | IMAP password |
| `CLAUDE_API_KEY` | Yes | `sk-ant-...` | Anthropic Claude API key |
| `CODEX_API_KEY` | Yes | `sk-...` | OpenAI API key for Codex |
| `GEMINI_API_KEY` | Yes | `AIza...` | Google Gemini API key |
| `PROJECT_ROOT_DIR` | Yes | `/data/projects` | Root directory for project storage |
| `HEALTH_CHECK_INTERVAL` | No | `30000` | Health check interval in ms (default 30s) |
| `CIRCUIT_BREAKER_THRESHOLD` | No | `5` | Failures before trip (default 5) |

## Deployment Considerations

### Production Deployment

1. **Environment Setup**
   - Load all required environment variables from secure vault (not .env)
   - Set NODE_ENV=production for optimized builds
   - Enable health endpoints for load balancer monitoring

2. **Scaling**
   - Each OpenAgora instance operates independently
   - Deploy multiple instances behind a load balancer for redundancy
   - Use sticky sessions for WebSocket-based adapters (if future enhancement)
   - Share PROJECT_ROOT_DIR across instances (NFS/shared storage recommended)

3. **Reliability**
   - Configure process manager (systemd, PM2) for auto-restart
   - Set up log aggregation (ELK, Datadog) to collect Winston logs
   - Monitor health endpoint regularly for circuit breaker status
   - Set up alerting on health check failures

4. **Security**
   - Never commit API keys (use environment variables)
   - Validate webhook signatures (Express middleware ready)
   - Rotate bot tokens periodically
   - Use HTTPS for webhook endpoints
   - Restrict PROJECT_ROOT_DIR access to application process only

5. **Storage**
   - PROJECT_ROOT_DIR must support concurrent git operations
   - Ensure sufficient disk space for worktrees (multiplied by concurrent tasks)
   - Back up PROJECT_ROOT_DIR regularly

### Performance Tuning

- **Concurrency**: Adjust per-project queue limits in config
- **Health Checks**: Tune HEALTH_CHECK_INTERVAL based on expected task volume
- **Circuit Breaker**: Adjust CIRCUIT_BREAKER_THRESHOLD for fault tolerance vs speed
- **Model Pipeline**: Configure multi-stage thresholds in model router

### Monitoring

- Health endpoint: `GET /health` returns JSON status
- Metrics available via Winston logs (export to monitoring system)
- Circuit breaker state exposed in health response
- Task discovery reports active tasks to health daemon

## Module System

OpenAgora uses ES modules (ESM) exclusively:
- `"type": "module"` in package.json
- All imports use `.js` file extensions
- No CommonJS require() statements
- Compatible with Node.js 22 LTS native ESM support
