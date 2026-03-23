# OpenAgora Modules Reference

## Module Directory Structure

```
src/
├── adapters/           # Channel input adapters
├── agents/             # Agent registry, executor, P2P routing
├── config/             # Configuration loading
├── health/             # Health monitoring, process watching
├── models/             # Model orchestration, routing
├── queue/              # Task queue per project
├── router/             # Project routing, command parsing
├── cli/                # CLI interface
├── utils/              # Shared utilities
└── types/              # TypeScript type definitions
```

## Core Modules

### adapters/ - Channel Adapters

**Responsibility**: Normalize messages from external channels to `ChannelMessage` type.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `BaseAdapter` | Abstract interface for all adapters |
| `AdapterManager` | Lifecycle manager for all adapters |
| `SlackAdapter` | Slack Bot API integration (@slack/bolt) |
| `DiscordAdapter` | Discord Bot API integration (discord.js) |
| `TelegramAdapter` | Telegram Bot API integration (telegraf) |
| `EmailAdapter` | Email polling (IMAP) and sending (SMTP) |
| `WebhookAdapter` | HTTP webhook receiver (Express) |
| `CliAdapter` | CLI stdin/stdout interface |

**Public Interface**:

```typescript
abstract class BaseAdapter {
  readonly type: ChannelType;
  setHandler(handler: (msg: ChannelMessage) => Promise<void>): void;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
}

class AdapterManager {
  constructor(config: AppConfig, router: ProjectRouter);
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
```

**Key Dependencies**:
- `@slack/bolt`, `discord.js`, `telegraf`, `nodemailer`, `imapflow`, `express`
- `ProjectRouter.handleMessage()` callback

### agents/ - Agent Execution Layer

**Responsibility**: Load agent definitions, execute agents, manage inter-agent communication.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `AgentRegistry` | Load `.claude/agents/moai/*.md` definitions |
| `AgentExecutor` | Spawn claude CLI subprocess with 30-min timeout |
| `BuilderAgent` | Dynamically create agents for unmapped domains |
| `P2PRouter` | Enable agent-to-agent messaging |

**Public Interface**:

```typescript
class AgentRegistry {
  constructor(projectRoot: string);
  getAgent(agentId: string): AgentDefinition | undefined;
  listAgents(domain?: DomainType): AgentDefinition[];
  registerAgent(def: AgentDefinition): void;
}

class AgentExecutor {
  constructor(processWatcher: ProcessWatcher);
  run(task: QueuedTask, agentId: string, projectPath: string): Promise<ExecutionResult>;
}

interface ExecutionResult {
  taskId: string;
  agentId: string;
  success: boolean;
  output: string;
  durationMs: number;
}

class P2PRouter {
  sendMessage(fromAgentId: string, toAgentId: string, payload: object): Promise<void>;
  registerHandler(agentId: string, handler: (msg: object) => Promise<void>): void;
}
```

**Key Dependencies**:
- `ProcessWatcher` (for process lifecycle)
- `CircuitBreakerRegistry` (for fault protection)
- `WorktreeManager` (for isolation)

### config/ - Configuration Loading

**Responsibility**: Load and validate YAML/JSON configuration from environment and config files.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `loadConfig()` | Async load configuration (env vars + YAML) |

**Public Interface**:

```typescript
interface AppConfig {
  registry: {
    projectsPath: string;
    agentsPath: string;
  };
  health: {
    port: number;
    interval: number;
  };
  adapters: {
    slack?: SlackAdapterConfig;
    discord?: DiscordAdapterConfig;
    webhook: { port: number };
    // ...other adapters
  };
}

async function loadConfig(): Promise<AppConfig>;
```

**Key Dependencies**:
- `yaml` package for parsing
- `dotenv` for environment variables
- `zod` for runtime validation

### health/ - Health Monitoring

**Responsibility**: Monitor system health, track processes, discover orphaned tasks, alert on degradation.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `HealthDaemon` | Orchestrate all health checks (main entry point) |
| `HealthMonitor` | Aggregate health metrics and status |
| `ProcessWatcher` | Track spawned CLI processes, enforce 30-min timeout |
| `CircuitBreaker` | Per-agent fault protection (open after 5 failures) |
| `CircuitBreakerRegistry` | Global circuit breaker management |
| `TaskDiscovery` | Find orphaned/stalled tasks in registry |
| `RalphLoop` | Detect stagnation in multi-stage execution |
| `Notifier` | Alert on health state changes |
| `WorktreeManager` | Manage git worktree isolation per agent |

**Public Interface**:

```typescript
class HealthDaemon {
  constructor(config: AppConfig);
  start(): Promise<void>;
  stop(): Promise<void>;
  getProcessWatcher(): ProcessWatcher;
  getNotifier(): Notifier;
  setRouter(router: ProjectRouter): void;
  setDiscoveryCallback(cb: (task: DiscoveredTask) => Promise<void>): void;
}

interface HealthStatus {
  healthy: boolean;
  uptime: number;
  activeProjects: number;
  queueDepth: number;
  circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'>;
  lastCheck: Date;
}

class ProcessWatcher {
  track(processId: number, agentId: string): void;
  untrack(processId: number): void;
  getStatus(): ProcessStatus[];
}

class CircuitBreaker {
  isOpen(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
}
```

**Key Dependencies**:
- `ProjectRouter` (for task recovery)
- `ProcessWatcher` (mutual ownership in HealthDaemon)
- `express` (health endpoint)

### models/ - Model Orchestration

**Responsibility**: Map task domains to model capabilities, execute multi-stage pipeline.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `ModelRouter` | Domain → capability mapping |
| `MultiStageOrchestrator` | 3-stage execution (Primary → Review → Verify) |

**Public Interface**:

```typescript
class ModelRouter {
  routeByDomain(domain: DomainType): ModelRoute;
  routeByCapability(capability: Capability): ModelRoute;
}

interface ModelRoute {
  primary: string;      // Always executed
  review?: string;      // Optional validation (5-min timeout)
  verify?: string;      // Optional confirmation (5-min timeout)
  fallback?: string;    // If all stages fail
}

class MultiStageOrchestrator {
  constructor(
    executor: AgentExecutor,
    configDir: string,
    p2pRouter: P2PRouter,
  );
  executeStages(task: QueuedTask, agentId: string): Promise<MultiStageResult>;
}

interface MultiStageResult {
  taskId: string;
  agentId: string;
  success: boolean;
  primary: ExecutionResult;
  review: StageResult;
  verify: StageResult;
  summary: string;
  durationMs: number;
  iterations: number;
  convergedReason?: 'verified' | 'quality-gates' | 'stagnation' | 'max-iterations';
}
```

**Key Dependencies**:
- `AgentExecutor` (for subprocess spawning)
- `RalphLoop` (for stagnation detection)
- `P2PRouter` (for inter-stage messaging)

### queue/ - Task Queue

**Responsibility**: Per-project FIFO task queuing with priority ordering.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `ProjectQueue` | Map of per-project FIFO queues |

**Public Interface**:

```typescript
class ProjectQueue {
  enqueue(projectId: string, task: QueuedTask): void;
  dequeue(projectId: string): QueuedTask | undefined;
  peek(projectId: string): QueuedTask | undefined;
  size(projectId: string): number;
  allQueues(): Map<string, QueuedTask[]>;
}
```

**Key Dependencies**:
- `QueuedTask` type (from types/)

### router/ - Project Routing

**Responsibility**: Central message dispatch, project routing, command parsing, project creation.

**Key Exports**:

| Class | Purpose |
|-------|---------|
| `ProjectRouter` | Central dispatch hub for all messages |
| `ProjectRegistry` | In-memory project catalog (persisted to JSON) |
| `ProjectCreator` | Create new projects on-demand |
| `CommandParser` | Parse `/run` `/setup` `/list` `/help` commands |

**Public Interface**:

```typescript
class ProjectRouter {
  constructor(config: AppConfig, processWatcher: ProcessWatcher);
  init(): Promise<void>;
  handleMessage(msg: ChannelMessage): Promise<void>;
  handleDiscoveredTask(task: DiscoveredTask): Promise<void>;
  setNotifier(notifier: Notifier): void;
  getProject(projectId: string): Project | undefined;
  listProjects(): Project[];
}

class ProjectRegistry {
  constructor(projectsPath: string);
  getProject(projectId: string): Project | undefined;
  listProjects(): Project[];
  saveProject(project: Project): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

class ProjectCreator {
  create(
    name: string,
    path: string,
    githubRepo: string,
    domain: DomainType,
  ): Promise<Project>;
}

class CommandParser {
  parseCommand(content: string): ParsedCommand | undefined;
}
```

**Key Dependencies**:
- `AgentRegistry`, `AgentExecutor` (for agent selection)
- `MultiStageOrchestrator` (for execution)
- `ProjectQueue` (for task buffering)
- `ProcessWatcher`, `Notifier` (for health integration)

### cli/ - CLI Interface

**Responsibility**: Command-line interface for setup, token management, environment configuration.

**Key Exports**:

| Module | Purpose |
|--------|---------|
| `main.ts` | CLI entry point, command routing |
| `setup.ts` | Interactive setup wizard |
| `tokens.ts` | Token generation and validation |
| `env-manager.ts` | Environment variable management |

**Key Dependencies**:
- `inquirer` (interactive prompts)
- `simple-git` (Git configuration)

### utils/ - Shared Utilities

**Responsibility**: Logging and common helpers.

**Key Exports**:

| Export | Purpose |
|--------|---------|
| `logger` | Winston logger instance (structured JSON logging) |

**Characteristics**:
- Singleton logger configured for JSON output
- Log levels: error, warn, info, debug
- Includes timestamp, context labels

### types/ - Type Definitions

**Responsibility**: Centralized TypeScript type definitions for all modules.

**Key Exports**:

```typescript
type ChannelType = 'slack' | 'discord' | 'telegram' | 'email' | 'webhook' | 'cli';
type DomainType = 'planning' | 'development' | 'database' | 'analysis' | 'research' | 'writing' | 'general';
type Capability = 'best-coding' | 'best-writing' | 'best-research' | 'best-image' | 'best-analysis' | 'best-ui' | 'best-planning';

interface ChannelMessage {
  id: string;
  channel: ChannelType;
  channelId: string;
  userId: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  replyFn: (message: string) => Promise<void>;
}

interface Project {
  id: string;
  name: string;
  path: string;
  githubRepo: string;
  domain: DomainType;
  agents: string[];
  status: 'active' | 'paused' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

interface QueuedTask {
  id: string;
  projectId: string;
  message: ChannelMessage;
  priority: number;
  enqueuedAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface HealthStatus {
  healthy: boolean;
  uptime: number;
  activeProjects: number;
  queueDepth: number;
  circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'>;
  lastCheck: Date;
}
```

## Module Dependency Graph

```
types/
  ↑
  ├── config/
  │     ↑
  │     └── index.ts
  │
  ├── utils/ (logger)
  │     ↑
  │     └── (used by all modules)
  │
  ├── adapters/
  │     ↑
  │     ├── router/
  │     └── index.ts
  │
  ├── router/
  │     ↑
  │     ├── queue/
  │     ├── agents/
  │     ├── models/
  │     ├── health/ (ProcessWatcher)
  │     └── index.ts
  │
  ├── agents/
  │     ↑
  │     ├── health/ (ProcessWatcher, CircuitBreaker)
  │     └── router/
  │
  ├── models/
  │     ↑
  │     ├── agents/
  │     ├── health/ (RalphLoop)
  │     └── router/
  │
  ├── health/
  │     ↑
  │     ├── router/ (ProjectRouter)
  │     └── index.ts
  │
  └── cli/
        ↑
        └── config/, router/
```

## Export Patterns

All modules export:
1. Primary class or function (default export or named)
2. Type definitions (interfaces, enums)
3. Constants (timeout values, defaults)

Example:
```typescript
// src/agents/executor.ts
export class AgentExecutor { ... }
export interface ExecutionResult { ... }
export const TIMEOUT_MS = 30 * 60 * 1000;
```

## Testing

Each module includes adjacent `__tests__/` directory:

```
src/module/
├── index.ts
├── helper.ts
└── __tests__/
    ├── index.test.ts
    └── helper.test.ts
```

Testing strategy:
- **Unit tests**: Mock external dependencies
- **Integration tests**: Use real adapters (tests in manager.test.ts)
- **Test framework**: Vitest with vi.mock()
- **Coverage target**: 85%+ per module
