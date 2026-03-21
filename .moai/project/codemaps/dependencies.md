# OpenAgora Dependency Graph & Analysis

## Internal Module Dependency Graph

```
                          index.ts
                             │
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────▼────────┐  ┌────▼────────┐  ┌──▼─────────────┐
    │ config/loader  │  │ health/     │  │ adapters/      │
    │                │  │ daemon      │  │ manager        │
    └────────────────┘  │             │  │                │
                        │ ─starts─→   │  └──┬────────────┬┘
                        └────────┬────┘     │            │
                                 │      ┌──▼──┐      ┌──▼──┐
                    ┌────────────┼──→   │slack│      │ cli │
                    │            │      └─────┘      └─────┘
              ┌─────▼──────────────┐
              │ router/            │
              │ project-router     │
              │                    │
              │ ─matches→ registry │
              │ ─creates→ project  │
              │ ─detects→ domain   │
              │ ─selects→ agent    │
              │ ─enqueues→ task    │
              └─────┬──────────────┘
                    │
        ┌───────────┼─────────────────┐
        │           │                 │
    ┌───▼───┐  ┌────▼─────┐  ┌───────▼─────┐
    │queue/ │  │agents/    │  │models/      │
    │       │  │executor   │  │multi-stage  │
    └───────┘  └──┬────────┘  └──┬──────────┘
                  │              │
                  │         ┌────▼────┐
                  │         │review   │
                  │         │(codex)  │
                  │         └─────────┘
                  │
             ┌────▼────────┐
             │claude CLI   │
             │subprocess   │
             └─────────────┘

                health/
                daemon
                  │
        ┌─────────┼──────────┐
        │         │          │
    process-   task-      circuit-
    watcher   discovery   breaker
        │
        │ (kills zombies)
        │
    spawned
    processes
```

## External Package Dependencies

### Communication Channels (6 adapters)

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `@slack/bolt` | ^3.22.0 | Slack integration | Receive messages, send replies |
| `discord.js` | ^14.16.0 | Discord integration | Bot events, message handling |
| `telegraf` | ^4.16.0 | Telegram integration | Bot commands, message routing |
| `imapflow` | ^1.2.16 | Email ingestion | IMAP client, email polling |
| `nodemailer` | ^8.0.3 | Email sending | SMTP for replies |
| `@types/nodemailer` | ^7.0.11 | Type defs | TypeScript support |
| `express` | ^4.21.0 | HTTP server | Webhook endpoint, health check |

**Total**: 7 packages, 1 type definition

---

### Task Management

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `p-queue` | ^8.0.0 | Queue management | Per-project FIFO queues |

**Total**: 1 package

---

### Version Control & Project Management

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `simple-git` | ^3.27.0 | Git wrapper | Create repos, commit, branch |

**Total**: 1 package

---

### Configuration & Validation

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `yaml` | ^2.6.0 | YAML parsing | Load config files |
| `zod` | ^3.24.0 | Runtime validation | Validate config schema |
| `dotenv` | ^16.4.0 | Environment loading | Load .env files |

**Total**: 3 packages

---

### Logging

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `winston` | ^3.17.0 | Structured logging | All debug, info, warn, error logs |

**Total**: 1 package

---

### Type Definitions

| Package | Version | Purpose | Usage |
|---------|---------|---------|-------|
| `@types/node` | ^20.17.0 | Node.js types | Standard library |
| `@types/express` | ^4.17.0 | Express types | HTTP framework |

**Total**: 2 packages

---

### Runtime

- **Node.js**: 20+ LTS (from package.json @types/node ^20.17.0)
- **Module System**: ESM (package.json "type": "module")

**Total Dependency Count**: 18 packages (16 npm + 2 type defs)

---

## Module-to-Package Mapping

| Module | External Dependencies |
|--------|----------------------|
| `adapters/slack.ts` | @slack/bolt, express, types |
| `adapters/discord.ts` | discord.js |
| `adapters/telegram.ts` | telegraf |
| `adapters/email.ts` | imapflow, nodemailer, @types/nodemailer |
| `adapters/webhook.ts` | express |
| `agents/executor.ts` | child_process (Node.js builtin) |
| `config/loader.ts` | yaml, zod, dotenv |
| `health/daemon.ts` | http (Node.js builtin), express |
| `models/multi-stage.ts` | none (internal only) |
| `queue/project-queue.ts` | p-queue |
| `router/project-router.ts` | path (Node.js builtin) |
| `router/registry.ts` | fs (Node.js builtin) |
| `router/project-creator.ts` | simple-git, path (Node.js builtin) |
| `utils/logger.ts` | winston |

---

## Circular Dependency Analysis

**Result**: NO CIRCULAR DEPENDENCIES DETECTED

**Dependency Direction**:
```
config
  ↓
health, adapters ←─┐
  ↓                │
router ────────────┤
  ↓                │
queue, agents ─────┤
  ↓                │
models ────────────┘
  ↓
(output)
```

**Call Chain**:
1. index.ts initializes config
2. health/daemon starts (owns ProcessWatcher)
3. router initialized with ProcessWatcher reference
4. Adapters feed into router
5. Router enqueues to queue
6. Queue executes agents
7. Agents report to models
8. Models use health callbacks (teammateIdle gate)

**Safety**: Circular calls prevented by:
- Health daemon doesn't call router (uses callback injection)
- Router doesn't call health during message handling
- Agents don't call router (isolated subprocess)

---

## Dependency Risk Assessment

### Low Risk
- **winston** (logging): No behavioral dependency; safe to upgrade
- **zod** (validation): Lightweight, no side effects
- **dotenv** (env): Single load at startup
- **express** (HTTP): Isolated to adapters and health server
- **simple-git** (VCS): Calls external git binary (safe isolation)

### Medium Risk
- **p-queue**: Core to concurrency model; breaking changes could break P1 fix
- **yaml**: Config parsing; breaking schema could break startup
- **@slack/bolt, discord.js, telegraf**: Adapter interfaces could change
- **imapflow, nodemailer**: Email adapters; less critical than Slack/Discord

### High Risk
- **node.js child_process** (builtin): Core to agent execution; subprocess contract critical

---

## Upgrade Recommendations

| Package | Current | Latest | Recommendation |
|---------|---------|--------|-----------------|
| @slack/bolt | ^3.22.0 | 3.x | Safe (minor version) |
| discord.js | ^14.16.0 | 14.x | Safe (minor version) |
| telegraf | ^4.16.0 | 4.x | Safe (minor version) |
| express | ^4.21.0 | 4.x | Safe (minor version) |
| p-queue | ^8.0.0 | 8.x | Review before upgrading |
| zod | ^3.24.0 | 3.x | Safe (minor version) |
| simple-git | ^3.27.0 | 3.x | Safe (minor version) |
| winston | ^3.17.0 | 3.x | Safe (minor version) |

**No Major Version Upgrades Required** for current stability.

---

## Transitive Dependencies (Top Level)

Note: Package-lock.json contains full transitive tree. Key direct dependencies only listed above.

**High-Level Transitive Risks**:
- @slack/bolt → async, got (HTTP client)
- discord.js → dependencies on websocket, serialization libraries
- express → body-parser, cookie-parser, middleware ecosystem

**Mitigation**: Lock all versions in package-lock.json; run `npm audit` regularly.

---

## Import Path Analysis

### Relative Imports (Internal)
```typescript
import { ProjectRouter } from '../router/project-router.js'
import type { ChannelMessage } from '../types/index.js'
import { logger } from '../utils/logger.js'
```

All use relative paths with `.js` extensions (ESM convention).

### Absolute Imports (External)
```typescript
import { spawn } from 'node:child_process'    // Node.js builtin
import { readFileSync } from 'node:fs'        // Node.js builtin
import express from 'express'                  // npm
import { App } from '@slack/bolt'              // npm scoped
```

Clear separation between builtin (node:) and npm packages.

---

## Dependency Conflict Matrix

| Conflict | Risk | Mitigation |
|----------|------|-----------|
| Multiple HTTP servers (express + slack/bolt) | Low | Express for health; Bolt for Slack webhooks (separate ports) |
| Multiple async patterns (promises vs async/await) | Low | Codebase uses async/await consistently |
| Node.js version mismatch | Medium | Enforce Node.js 20+ LTS in CI/dockerfile |
| Workspace isolation (projects) | Medium | Git worktrees per task; no shared mutable state |

---

## Dependency Size Profile

| Category | Count | Size Impact |
|----------|-------|-------------|
| Node.js builtins | 3 | ~0 (included in runtime) |
| Logging | 1 | ~500 KB |
| HTTP + adapters | 6 | ~15 MB |
| Queueing | 1 | ~200 KB |
| Git | 1 | ~500 KB |
| Config | 3 | ~1 MB |
| Type defs | 2 | ~0 (TS only) |
| **Total** | **18** | **~18 MB** |

---

**Version**: 0.1.0
**Last Updated**: 2026-03-21
**Audit**: npm audit clean (no vulnerabilities)
