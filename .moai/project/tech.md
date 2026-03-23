# Technology Stack

## Overview
OpenAgora is a TypeScript-based multi-agent orchestration platform running on Node.js 22 LTS. It uses ES2022 modules, strict TypeScript, and message-driven architecture with git-backed persistence.

## Language & Runtime

| Component | Version | Rationale |
|-----------|---------|-----------|
| TypeScript | 5.7+ | Strict type safety, explicit return types for API clarity |
| ES Module Standard | ES2022 | Native async/await, tree-shaking support, no CJS complexity |
| Node.js | 22 LTS | Long-term stability, native ESM support, built-in test runner |

## Framework Choices & Rationale

### Communication Frameworks

**Slack: @slack/bolt 3.22.0**
- Rationale: Official SDK, Socket Mode for real-time bidirectional communication without polling
- Use: Receive messages via event listeners, send via web API, manage connection state

**Discord: discord.js 14.16.0**
- Rationale: Comprehensive intent-based event system, clean async/await API
- Use: React to guild messages, implement command parsing, manage bot presence

**Telegram: telegraf 4.16.0**
- Rationale: Lightweight, excellent for simplicity, polling-based (suitable for background workers)
- Use: Handle message updates, support webhook mode for scalability

**Email: imapflow 1.2.16 + nodemailer 8.0.3**
- Rationale: imapflow – strict IMAP4 compliance, async/await support; nodemailer – proven reliability
- Use: Poll mailbox for documents, parse attachments, send status updates

**HTTP Webhooks: express 4.21.0**
- Rationale: Minimal, proven framework; sufficient for webhook reception without framework overhead
- Use: Receive JSON payloads, validate signatures, route to project queues

**CLI: tsx 4.19.0**
- Rationale: TypeScript execution without build step; allows npm scripts for setup and token validation
- Use: Interactive configuration, token management, local task execution

### Data Validation & Persistence

**Zod 3.24.0** – Runtime schema validation
- Rationale: TypeScript-first, compositional, clear error messages
- Use: Validate config files, task payloads, model responses at system boundaries

**simple-git 3.27.0** – Git operations
- Rationale: Promisified API, comprehensive command support, stable
- Use: Create worktrees, manage project repos, resolve merge conflicts

**yaml 2.6.0** – Configuration parsing
- Rationale: YAML 1.2 compliant, streaming support
- Use: Load channels.yaml, models.yaml with full YAML expressiveness

### Async & Concurrency

**p-queue 8.0.0** – Task queue with concurrency control
- Rationale: Per-project FIFO with configurable concurrency limits
- Use: Prevent thundering herd, rate-limit model API calls

**winston 3.17.0** – Structured logging
- Rationale: Multiple transports, JSON serialization, levels
- Use: Production-grade logs for debugging, monitoring, compliance

### Development Tools

**Vitest 4.1.0** – Test runner
- Rationale: Vite-native, ESM-first, fast execution, excellent for TypeScript
- Use: Unit tests with 85%+ coverage target, fixtures for shared test data

**@vitest/coverage-v8 4.1.0**
- Rationale: V8 engine provides native coverage without instrumentation overhead
- Use: Coverage measurement and reports

**ESLint 8.57.0 + @typescript-eslint 6.21.0**
- Rationale: Enforces consistency, catches common errors
- Use: Lint configuration in `eslint.config.mjs` (flat config format)

## Build Configuration

```bash
# TypeScript compilation (strict mode)
tsc                    # dist/
# Watch mode for development
tsx watch src/index.ts # Real-time recompilation

# Test execution (ESM native)
vitest run             # Single run
vitest                 # Watch mode
vitest --coverage      # Coverage report

# Production build
npm run build
npm start              # dist/index.js
```

**tsconfig.json settings:**
- `target: ES2022` – Modern JavaScript features
- `module: Node16` – ESM with proper import resolution
- `strict: true` – All strict checks enabled
- `noUnusedLocals: true` – Catch dead code
- `declaration: true` – Generate .d.ts for library usage

## Deployment Options

### Local Development
```bash
npm install
npm run build
npm start              # Runs dist/index.js with health/webhook endpoints
```

### Docker (Planned)
- Multi-stage build: tsc → minimal Node image
- Volume mounts: project workspace, .claude config (read-only)
- Environment: `.env` file or compose secrets
- Networking: Health (port 3001), Webhook (port 3000)

### Systemd Service
```bash
# openagora.service
[Service]
Type=simple
User=openagora
WorkingDirectory=/opt/openagora/app
ExecStart=/usr/bin/node dist/index.js
Restart=always
StandardOutput=journal
StandardError=journal
```

**Auto-restart** on failure with backoff via systemd.

## MCP Server Integrations

OpenAgora connects to specialized MCP servers for extended capabilities:

| MCP Server | Purpose | Status |
|-----------|---------|--------|
| **Notion** | Document management, knowledge base access | Configured |
| **GitHub** | Repository operations, PR review, issue tracking | Configured |
| **Sequential Thinking** | Complex reasoning and architecture design | Configured |
| **Memory** | Persistent knowledge and lesson capture | Configured |
| **Exa** | Web search and real-time information | Configured |
| **Firecrawl** | Website scraping and content extraction | Configured |
| **Playwright** | Browser automation and visual testing | Configured |
| **Context7** | Up-to-date API documentation lookup | Configured |

**Configuration:** `.mcp.json` specifies server endpoints and authentication.

## External API Dependencies

```yaml
# Required (core functionality)
ANTHROPIC_API_KEY          # Claude models (primary)
SLACK_BOT_TOKEN            # Slack adapter
DISCORD_BOT_TOKEN          # Discord adapter
TELEGRAM_BOT_TOKEN         # Telegram adapter

# Optional (extended capabilities)
GEMINI_API_KEY             # Verification stage (multi-stage)
OPENAI_API_KEY             # DALL-E, GPT-4 code review
PERPLEXITY_API_KEY         # Research queries
NOTION_API_KEY             # MCP integration
GITHUB_TOKEN               # Repository access
EXA_API_KEY                # MCP integration
FIRECRAWL_API_KEY          # MCP integration
```

## Development Environment Setup

### Prerequisites
- Node.js 22+ (LTS)
- npm 10+ (included with Node 22)
- Git 2.30+ (for worktree support)

### Installation
```bash
# 1. Clone repository
git clone <repo-url>
cd openagora

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with API keys

# 4. Build
npm run build

# 5. Verify
npm test               # Run test suite
npm start              # Start application
```

### Development Workflow
```bash
# Watch mode (recompile on changes)
npm run dev            # tsx watch src/index.ts

# Test with watch
npm run test:watch

# Lint
npm run lint

# Type check (without emit)
npm run typecheck
```

## Code Style & Standards

**Enforced by TypeScript/ESLint:**
- ESM modules (no CommonJS)
- Const/let (no var)
- Strict null checks
- Async/await (no callback-hell)
- Explicit return types on exported functions
- No `any` type (use `unknown`)

**Convention over Configuration:**
- PascalCase: Classes, types
- camelCase: Functions, variables
- kebab-case: File names (e.g., `project-router.ts`)
- *.test.ts: Test files

## Performance Tuning

### Concurrency Control
```typescript
// p-queue limits parallel model API calls
const modelQueue = new PQueue({ concurrency: 3 });
// Prevents rate-limit exhaustion
```

### Circuit Breaker
```yaml
# config/health.yaml
circuit_breaker:
  failure_threshold: 5    # Consecutive failures before shutdown
  recovery_timeout: 300   # Seconds before retry attempt
```

### Ralph Loop (Stagnation Detection)
```yaml
ralph_loop:
  enabled: true
  stagnation_threshold: 3  # Iterations without improvement
  timeout: 600             # Max 10 minutes per agent
```

## Security Considerations

- **Environment Variables:** All API keys in `.env`, not committed to git
- **Input Validation:** Zod schemas at all system boundaries
- **HTTPS:** Webhook endpoint supports TLS (in production)
- **Rate Limiting:** p-queue + API key quotas prevent abuse
- **Isolation:** Git worktrees prevent cross-agent contamination
- **Logging:** JSON structured logs (no secrets in output)

## Dependency Versions

**Production (npm install):**
```json
{
  "@slack/bolt": "^3.22.0",
  "@types/nodemailer": "^7.0.11",
  "discord.js": "^14.16.0",
  "dotenv": "^16.4.0",
  "express": "^4.21.0",
  "imapflow": "^1.2.16",
  "nodemailer": "^8.0.3",
  "p-queue": "^8.0.0",
  "simple-git": "^3.27.0",
  "telegraf": "^4.16.0",
  "winston": "^3.17.0",
  "yaml": "^2.6.0",
  "zod": "^3.24.0"
}
```

**Development (npm install --save-dev):**
```json
{
  "@types/express": "^4.17.0",
  "@types/node": "^20.17.0",
  "@typescript-eslint/eslint-plugin": "^6.21.0",
  "@typescript-eslint/parser": "^6.21.0",
  "@vitest/coverage-v8": "^4.1.0",
  "eslint": "^8.57.0",
  "tsx": "^4.19.0",
  "typescript": "^5.7.0",
  "vitest": "^4.1.0"
}
```

All dependencies pinned to major versions; minor/patch updates included via `^`.

## Monitoring & Observability

**Health Endpoint:** `GET /health`
```json
{
  "status": "healthy",
  "uptime": 86400,
  "activeProjects": 5,
  "queueDepth": 3,
  "lastCheck": "2026-03-23T10:30:00Z"
}
```

**Metrics Endpoint:** `GET /metrics`
- Active agents
- Model API latency
- Error rates by channel
- Queue depths per project

**Logging:** Winston produces structured JSON to:
- `logs/openagora.log` (file)
- stdout (development)
- systemd journal (production)
