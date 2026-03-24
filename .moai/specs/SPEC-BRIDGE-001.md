# SPEC-BRIDGE-001: Thin Bridge Architecture Refactoring

**Status**: Draft
**Created**: 2026-03-24
**Author**: seokmogu
**Priority**: P0
**Depends on**: SPEC-ONBOARD-001 (completed)

---

## 1. Problem Statement

OpenAgora is currently a separate orchestration system that duplicates what Claude Code + MoAI already provides. It should be a thin bridge: receive messages from channels, pass them to Claude Code CLI, stream results back.

### Current Architecture (redundant)

```
Slack → Adapter → CommandParser → ProjectRouter
  → AgentRegistry (duplicate of .claude/agents/)
  → MultiStageOrchestrator (duplicate of MoAI workflow)
    → ModelRouter (duplicate of MoAI agent routing)
    → AgentExecutor → claude CLI
    → Review stage (codex)
    → Verify stage (claude/gemini)
  → RalphLoop (duplicate of MoAI ralph)
  → BuilderAgent (duplicate of MoAI builder-agent)
  → P2PRouter (duplicate of MoAI SendMessage)
```

### Target Architecture (thin bridge)

```
Slack → Adapter → CommandParser → ProjectQueue (FIFO)
  → ClaudeCliBridge (spawn claude -p, cwd=project)
  → Stream output → Reply to channel

Sidecar: ProcessWatcher, /health, queue metrics
```

---

## 2. Requirements (EARS Format)

### REQ-1: Replace MultiStageOrchestrator with ClaudeCliBridge

**When** a task is dequeued from ProjectQueue,
**the system shall** spawn a single `claude -p "<task>"` process in the project directory and stream stdout back to the originating channel,
**so that** all orchestration (agent selection, review, verification) is handled by Claude Code + MoAI internally.

**Acceptance Criteria:**
- AC-1.1: ClaudeCliBridge spawns `claude -p` with task content as prompt
- AC-1.2: stdout is streamed to channel via progress callback (5s throttle)
- AC-1.3: Process timeout (30min) and cleanup are maintained
- AC-1.4: No `--agent` flag — let Claude/MoAI decide which agent to use
- AC-1.5: CircuitBreaker remains but keyed by project, not agent

### REQ-2: Remove Redundant Orchestration Modules

**When** the bridge architecture is implemented,
**the system shall** remove all modules that duplicate Claude Code + MoAI functionality,
**so that** the codebase is minimal and maintainable.

**Files to remove:**
- `src/models/multi-stage.ts` — replaced by ClaudeCliBridge
- `src/models/router.ts` — model selection is Claude's job
- `src/agents/registry.ts` — agent catalog is in .claude/agents/
- `src/agents/builder-agent.ts` — MoAI builder-agent handles this
- `src/agents/p2p-router.ts` — MoAI SendMessage handles this
- `src/health/ralph-loop.ts` — MoAI ralph handles this
- `src/health/task-discovery.ts` — bridge doesn't discover tasks
- `src/health/worktree.ts` — Claude Code handles worktrees
- `config/models.yaml` — no model routing in bridge
- `registry/agents.json` — no agent registry in bridge

**Acceptance Criteria:**
- AC-2.1: All listed files removed
- AC-2.2: No import references to removed modules
- AC-2.3: Build passes with zero errors
- AC-2.4: Tests updated to reflect new architecture

### REQ-3: Simplify ProjectRouter

**When** a message is received from any channel,
**the system shall** parse the command, resolve the project path, enqueue the task, and execute via ClaudeCliBridge,
**so that** the routing logic is minimal and predictable.

**Acceptance Criteria:**
- AC-3.1: ProjectRouter has no dependency on AgentRegistry, MultiStageOrchestrator, BuilderAgent, P2PRouter
- AC-3.2: Chat verb directly spawns ClaudeCliBridge (no domain detection, no agent selection)
- AC-3.3: Run verb uses project path from registry (no new project creation in hot path)
- AC-3.4: ProjectCreator available only via explicit `create` command

### REQ-4: Simplify AgentExecutor → ClaudeCliBridge

**When** refactoring AgentExecutor,
**the system shall** rename it to ClaudeCliBridge and remove agent-specific logic,
**so that** it only handles: spawn, stream, timeout, cleanup.

**Acceptance Criteria:**
- AC-4.1: No `agentId` parameter — just `projectPath` and `prompt`
- AC-4.2: No `--agent` flag in spawn args
- AC-4.3: `--dangerously-skip-permissions` retained for autonomous execution
- AC-4.4: Progress callback and Slack reaction support retained
- AC-4.5: Env allowlist retained (security improvement from earlier)

### REQ-5: Prerequisites and Setup Documentation

**When** a user clones OpenAgora on a new machine,
**the system shall** provide clear documentation of all prerequisites, dependencies, and setup steps,
**so that** the bridge works correctly on any macOS or Linux environment.

**Acceptance Criteria:**
- AC-5.1: README lists all prerequisites:
  - Node.js >= 20
  - Claude Code CLI (authenticated)
  - MoAI ADK (optional, for advanced workflows)
  - npm packages (auto-installed)
- AC-5.2: README explains how to configure Claude Code for OpenAgora:
  - `.claude/settings.json` permissions for autonomous execution
  - CLAUDE.md setup for project context
- AC-5.3: README explains channel-specific setup:
  - Slack: Bot token + App token (Socket Mode)
  - Discord: Bot token
  - Telegram: Bot token from BotFather
  - Webhook: Secret key
- AC-5.4: `npm run cli:setup` wizard guides through all prerequisites
- AC-5.5: Startup validates all prerequisites with actionable error messages

### REQ-6: Health Monitoring Simplification

**When** the bridge architecture is active,
**the system shall** monitor only process-level health (not agent-level),
**so that** health checks are aligned with the thin bridge model.

**Acceptance Criteria:**
- AC-6.1: HealthDaemon monitors: uptime, active processes, queue depth
- AC-6.2: CircuitBreaker keyed by project (not agent)
- AC-6.3: ProcessWatcher monitors spawned claude processes
- AC-6.4: No TaskDiscovery, no RalphLoop in health daemon
- AC-6.5: Notifier sends alerts for: process timeout, circuit open, health degradation

---

## 3. Scope

### In Scope

| Area | Action | Files |
|------|--------|-------|
| New module | Create ClaudeCliBridge | `src/bridge/claude-cli-bridge.ts` |
| Refactor | Simplify ProjectRouter | `src/router/project-router.ts` |
| Refactor | Simplify HealthDaemon | `src/health/daemon.ts` |
| Remove | Orchestration modules | `src/models/*`, `src/agents/registry.ts`, `src/agents/builder-agent.ts`, `src/agents/p2p-router.ts` |
| Remove | Health modules | `src/health/ralph-loop.ts`, `src/health/task-discovery.ts`, `src/health/worktree.ts` |
| Remove | Config | `config/models.yaml`, `registry/agents.json` |
| Update | Documentation | `README.md`, `SPEC.md` |
| Update | Tests | All affected test files |
| Update | Setup wizard | `src/cli/setup.ts` |

### Out of Scope

- New channel adapter implementations
- MoAI ADK modifications
- Claude Code CLI changes
- UI/frontend development

---

## 4. Technical Design

### 4.1 ClaudeCliBridge

```typescript
// src/bridge/claude-cli-bridge.ts
export class ClaudeCliBridge {
  constructor(private processWatcher: ProcessWatcher) {}

  async run(
    projectPath: string,
    prompt: string,
    taskId: string,
    onProgress?: ProgressCallback,
  ): Promise<BridgeResult> {
    // spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], { cwd: projectPath })
    // stream stdout via onProgress
    // timeout after 30min
    // return { success, output, durationMs }
  }
}
```

### 4.2 Simplified Flow

```
Message received
  → CommandParser.parse()
  → if 'create': ProjectCreator (explicit only)
  → if 'run': resolve project → queue → ClaudeCliBridge
  → if 'chat' (default): queue as 'default' → ClaudeCliBridge
  → if 'status'/'list'/'help': respond directly
```

### 4.3 Prerequisites for New Environment

```
Required:
  1. Node.js >= 20.0.0
  2. Claude Code CLI (authenticated via `claude login`)
  3. npm install (project dependencies)

Optional:
  4. MoAI ADK binary (for /moai commands in Claude)
  5. GitHub CLI (for project repo creation)
  6. Channel tokens (Slack/Discord/Telegram)
```

---

## 5. Migration Path

1. Create ClaudeCliBridge from AgentExecutor (keep spawn/stream/timeout)
2. Rewire ProjectRouter to use ClaudeCliBridge instead of MultiStageOrchestrator
3. Remove redundant modules (models/*, agents/registry, builder-agent, p2p-router)
4. Simplify HealthDaemon (remove TaskDiscovery, RalphLoop references)
5. Update tests
6. Update README with prerequisites and setup guide
7. Update SPEC.md with new architecture description

---

## 6. Test Plan

| Test | Type | Validates |
|------|------|-----------|
| ClaudeCliBridge spawns claude process | Unit | REQ-1 |
| ClaudeCliBridge streams output | Unit | REQ-1 |
| ClaudeCliBridge handles timeout | Unit | REQ-1 |
| ProjectRouter routes to ClaudeCliBridge | Integration | REQ-3 |
| Build passes after module removal | Build | REQ-2 |
| Health endpoint returns correct status | Integration | REQ-6 |
| Setup wizard checks prerequisites | Unit | REQ-5 |
| Server starts without .env | Integration | REQ-5 |

---

Version: 1.0.0
