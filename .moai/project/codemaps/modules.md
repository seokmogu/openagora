# OpenAgora Module Structure

## Directory Layout

```
src/
├── index.ts                    # Application entry point
├── adapters/                   # Channel adapters (6 implementations)
├── agents/                     # Agent execution and registration
├── config/                     # Configuration loading
├── health/                     # Health monitoring and recovery
├── models/                     # Multi-stage orchestration and routing
├── queue/                      # Task queueing per project
├── router/                     # Project routing and dispatch
├── types/                      # Shared type definitions
└── utils/                      # Logging and utilities
```

## Module Details

### 1. adapters/ — Channel Integration

**Responsibility**: Accept messages from external channels, normalize to ChannelMessage type, feed into ProjectRouter.

**Adapters** (6 total):
- `slack.ts` - Slack Bolt integration (@slack/bolt)
- `discord.ts` - Discord.js integration
- `telegram.ts` - Telegraf integration
- `email.ts` - IMAP + Nodemailer (imapflow)
- `webhook.ts` - Generic HTTP webhook endpoint
- `cli.ts` - Standard input for local testing
- `base.ts` - Abstract base class
- `manager.ts` - Adapter lifecycle management

**Public Interface**:
```typescript
interface ChannelAdapter {
  start(): Promise<void>
  stop(): Promise<void>
}

interface ChannelMessage {
  id: string
  channel: ChannelType
  channelId: string
  userId: string
  content: string
  timestamp: Date
  metadata?: Record<string, unknown>
  replyFn: (message: string) => Promise<void>
}
```

**Dependencies**:
- External: @slack/bolt, discord.js, telegraf, imapflow, nodemailer, express
- Internal: types, logger, ProjectRouter

**Notes**:
- Each adapter implements the ChannelAdapter interface
- All messages routed through projectRouter.handleMessage()
- replyFn callback handles channel-specific response formatting (emoji, markdown)

---

### 2. agents/ — Agent Execution & Registry

**Responsibility**: Execute agents via claude CLI subprocess, manage agent lifecycle, support dynamic agent creation.

**Files**:
- `executor.ts` - Spawn claude CLI, manage timeout, process isolation
- `registry.ts` - Maintain builtin + dynamic agent registry
- `builder-agent.ts` - Create new specialist agents on-demand
- `p2p-router.ts` - Parse and route DELEGATE blocks between agents

**Public Interfaces**:

```typescript
// Executor
interface ExecutionResult {
  taskId: string
  agentId: string
  success: boolean
  output: string
  durationMs: number
}

// Registry
class AgentRegistry {
  getAgentForDomain(domain: DomainType): string
  getAllAgents(): AgentDefinition[]
  register(entry: AgentRegistryEntry): void
  has(agentId: string): boolean
}

// BuilderAgent
class BuilderAgent {
  create(config: AgentConfig): Promise<{ agentId: string; path: string }>
}
```

**Dependencies**:
- External: child_process (spawn)
- Internal: types, logger, health (ProcessWatcher, CircuitBreakerRegistry)

**Builtin Agents** (6):
- expert-planner
- expert-developer
- expert-dba
- expert-analyst
- expert-researcher
- expert-writer

**Dynamic Agents**:
- Created by BuilderAgent when user requests unknown domain
- Stored in `.claude/agents/moai/{domain}.md`
- Registered in `registry/agents.json`

**Execution Flow**:
1. ProjectRouter selects agentId
2. AgentExecutor.run() spawned claude subprocess
3. Claude CLI loads `.claude/agents/{id}.md`
4. Output captured, circuit breaker updated
5. Result passed to MultiStageOrchestrator

**Timeout**: 30 minutes per task (TIMEOUT_MS = 1800000)

---

### 3. config/ — Configuration Loading

**Responsibility**: Load and validate configuration from environment and config files.

**Files**:
- `loader.ts` - AppConfig loading from env + YAML

**Public Interface**:
```typescript
interface AppConfig {
  registry: { projectsPath: string }
  health: { port: number }
  adapters: Record<string, Record<string, unknown>>
  models: Record<string, Record<string, unknown>>
}
```

**Configuration Sources**:
1. Environment variables (e.g., BASE_PROJECT_DIR, GITHUB_USER)
2. `.moai/config/sections/*.yaml` files
3. Defaults for missing values

**Notes**:
- Uses zod for validation
- Supports YAML parsing

---

### 4. health/ — Monitoring & Recovery

**Responsibility**: Monitor system health, detect failures, recover automatically.

**Files**:
- `daemon.ts` - Main health loop, HTTP endpoint
- `health-monitor.ts` - Compute health status
- `process-watcher.ts` - Track spawned processes, detect zombies
- `circuit-breaker.ts` - Circuit breaker pattern per agent
- `ralph-loop.ts` - Convergence detection and retry logic
- `notifier.ts` - Send notifications (placeholder)
- `task-discovery.ts` - Detect incomplete work
- `worktree.ts` - Create/destroy git worktrees

**Key Monitoring Interval**: 10 minutes (HEALTH_INTERVAL_MS = 600000)

**ProcessWatcher**:
```typescript
interface ProcessWatcher {
  register(pid: number, taskId: string): void
  unregister(pid: number): void
  // Tracks active processes, kills on timeout
}
```

**CircuitBreakerRegistry**:
```typescript
class CircuitBreaker {
  isOpen(): boolean
  recordSuccess(): void
  recordFailure(): void
  // Open after 5 failures, half-open after 1 success
}
```

**RalphLoop** (Convergence Detection):
```typescript
class RalphLoop {
  decide(feedback: Feedback): 'continue' | 'converge' | 'abort'
  // Detects stagnation (same output twice) and quality gates
}
```

**TaskDiscovery**:
- Scans project directories for incomplete work
- Re-enqueues discovered tasks via ProjectRouter callback
- Handles P3 problem (work continuing across heartbeats)

**Worktree Manager**:
```typescript
class WorktreeManager {
  static create(projectPath: string, taskId: string): Promise<string>
  static remove(projectPath: string, taskId: string): Promise<void>
  // Git worktree per task (P4 isolation)
}
```

**Health Daemon HTTP Endpoint**:
- GET `/health` → HealthStatus JSON
- Used by load balancers or monitoring systems

---

### 5. models/ — Orchestration & Routing

**Responsibility**: Multi-stage execution pipeline and multi-model capability routing.

**Files**:
- `multi-stage.ts` - Primary → Review → Verify → Convergence
- `router.ts` - Map capabilities to model routes

**Multi-Stage Pipeline**:
```typescript
interface MultiStageResult {
  taskId: string
  agentId: string
  success: boolean
  primary: ExecutionResult      // Claude
  review: StageResult           // Codex (best-effort, timeout 5min)
  verify: StageResult           // Gemini (best-effort, with RalphLoop)
  summary: string
  durationMs: number
  iterations: number
  convergedReason?: 'verified' | 'quality-gates' | 'stagnation' | 'max-iterations'
}
```

**Stage Execution**:
1. **Primary**: AgentExecutor.run() → success or fail
2. **P2P Check**: Parse DELEGATE blocks, route to other agents if found
3. **Review** (optional): Codex reviews for correctness/completeness
4. **Verify** (optional): Gemini verifies factual accuracy
5. **Convergence**: RalphLoop detects stagnation or quality gates met

**Model Routing**:
```typescript
interface ModelRoute {
  primary: string          // always 'claude'
  review?: string          // 'codex' or undefined
  verify?: string          // 'gemini' or undefined
  fallback?: string        // fallback model
}
```

**Capability Mapping** (Domain → Capability):
- `development` → `best-coding`
- `database` → `best-coding`
- `analysis` → `best-analysis`
- `research` → `best-research`
- `writing` → `best-writing`
- `planning` → `best-planning`
- `general` → `best-coding`

---

### 6. queue/ — Task Queueing

**Responsibility**: Maintain per-project FIFO queues with concurrency=1.

**Files**:
- `project-queue.ts` - Concurrent queue per project

**Public Interface**:
```typescript
interface ProjectQueue {
  enqueue(projectId: string, message: ChannelMessage, job: () => Promise<void>): Promise<void>
  getDepth(projectId: string): number
  getStats(): Record<string, { size: number; pending: number }>
  getActiveProjects(): string[]
}
```

**Concurrency Model**:
- One queue per project
- One job executing at a time per project
- New jobs wait until current job completes
- Multiple projects can execute in parallel

**Implementation**: Uses p-queue for queue management

**Notes**:
- Solves P1 (multi-channel collision)
- Maintains order within project
- Prevents git/file conflicts (with worktrees)

---

### 7. router/ — Project Dispatch

**Responsibility**: Match incoming messages to projects, create new projects, route to queues.

**Files**:
- `project-router.ts` - Central dispatcher
- `registry.ts` - Project registry (persist to disk)
- `project-creator.ts` - Create new git-backed projects

**ProjectRouter Flow**:
```
handleMessage()
  ├─ Match existing project (by git repo, description)
  ├─ If not found:
  │  ├─ Detect domain (regex matching content)
  │  ├─ Extract/generate project name
  │  └─ Create new project (git repo)
  ├─ Select agent for domain
  ├─ If domain=general && content>100 chars:
  │  └─ BuilderAgent.create() new specialist
  └─ Enqueue to project queue
```

**Project Registry**:
```typescript
interface Project {
  id: string
  name: string
  path: string                   // Local filesystem path
  githubRepo: string
  domain: DomainType
  agents: string[]               // Agent roster
  status: 'active' | 'paused' | 'archived'
  createdAt: Date
  updatedAt: Date
}
```

**Domain Detection** (AgentExecutor.detectDomain):
```
content → regex patterns → DomainType
'sql schema migration' → 'database'
'write technical doc' → 'writing'
'analyze data trends' → 'analysis'
```

---

### 8. types/ — Shared Definitions

**Responsibility**: Type contracts for all modules.

**Main Types**:
```typescript
type ChannelType = 'slack' | 'discord' | 'telegram' | 'email' | 'webhook' | 'cli'
type DomainType = 'planning' | 'development' | 'database' | 'analysis' | 'research' | 'writing' | 'general'
type Capability = 'best-coding' | 'best-writing' | 'best-research' | 'best-image' | 'best-analysis' | 'best-ui' | 'best-planning'

interface ChannelMessage { ... }
interface Project { ... }
interface QueuedTask { ... }
interface AgentDefinition { ... }
interface HealthStatus { ... }
```

---

### 9. utils/ — Shared Utilities

**Responsibility**: Logging and common helpers.

**Files**:
- `logger.ts` - Winston logger configuration

**Logger Interface**:
```typescript
logger.info(message: string, metadata?: Record<string, unknown>)
logger.warn(message: string, metadata?: Record<string, unknown>)
logger.error(message: string, metadata?: Record<string, unknown>)
```

---

## Module Dependency Graph

```
index.ts
  ├─ config/loader
  ├─ health/daemon
  │  ├─ health/health-monitor
  │  ├─ health/process-watcher
  │  ├─ health/circuit-breaker
  │  ├─ health/task-discovery
  │  └─ health/notifier
  ├─ router/project-router
  │  ├─ router/registry
  │  ├─ router/project-creator
  │  ├─ agents/registry
  │  ├─ agents/executor
  │  │  ├─ health/process-watcher
  │  │  ├─ health/circuit-breaker
  │  │  └─ health/worktree
  │  ├─ agents/builder-agent
  │  ├─ agents/p2p-router
  │  ├─ queue/project-queue
  │  └─ models/multi-stage
  │     ├─ models/router
  │     ├─ agents/executor
  │     ├─ health/ralph-loop
  │     └─ agents/p2p-router
  └─ adapters/manager
     └─ adapters/{slack,discord,telegram,email,webhook,cli}
        └─ router/project-router

types/
utils/
```

**No Circular Dependencies**: Each layer cleanly depends on lower layers.

---

## Internal vs External Dependencies

### Internal (Own Code)
All `src/` modules are internal. Dependency direction:
- Adapters → Router → Queue → Executor → Orchestrator
- Health runs independently, receives callbacks

### External (npm)
- **slack/discord/telegram**: @slack/bolt, discord.js, telegraf
- **email**: imapflow, nodemailer
- **http**: express
- **logging**: winston
- **queuing**: p-queue
- **git**: simple-git
- **validation**: zod
- **yaml**: yaml
- **types**: @types/node, @types/express, @types/nodemailer

---

**Version**: 0.1.0
**Last Updated**: 2026-03-21
