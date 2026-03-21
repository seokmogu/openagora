# OpenAgora Architecture & Structure

## Directory Tree

```
openagora/
├── src/
│   ├── adapters/              # Channel integration layer
│   │   ├── base.ts           # BaseAdapter abstract class
│   │   ├── manager.ts        # AdapterManager orchestrates all adapters
│   │   ├── slack.ts          # Slack/Bolt integration
│   │   ├── discord.ts        # Discord.js integration
│   │   ├── telegram.ts       # Telegraf integration
│   │   ├── email.ts          # Email adapter (SMTP + IMAP)
│   │   ├── webhook.ts        # HTTP webhook receiver
│   │   └── cli.ts            # Interactive CLI interface
│   │
│   ├── agents/                # Agent execution & management
│   │   ├── registry.ts        # Agent registry and discovery
│   │   ├── executor.ts        # Task execution engine
│   │   ├── builder-agent.ts   # Dynamic agent generation
│   │   └── p2p-router.ts      # Agent-to-agent communication
│   │
│   ├── router/                # Central task routing
│   │   ├── project-router.ts  # Main task router and dispatcher
│   │   ├── project-creator.ts # Project initialization
│   │   └── registry.ts        # Project registry (in-memory store)
│   │
│   ├── models/                # Model execution pipeline
│   │   ├── multi-stage.ts     # Multi-stage orchestrator (Claude → Codex → Gemini)
│   │   └── router.ts          # Model selection and routing logic
│   │
│   ├── health/                # Health & reliability systems
│   │   ├── daemon.ts          # Main health daemon process
│   │   ├── health-monitor.ts  # Health checks and metrics
│   │   ├── circuit-breaker.ts # Circuit breaker pattern (5 failures = trip)
│   │   ├── process-watcher.ts # Zombie process detection
│   │   ├── ralph-loop.ts      # Stagnation detection & auto-recovery
│   │   ├── task-discovery.ts  # Active task monitoring
│   │   ├── notifier.ts        # Event notifications
│   │   ├── worktree.ts        # Git worktree isolation management
│   │   └── __tests__/         # Health system unit tests
│   │
│   ├── queue/                 # Task queueing
│   │   ├── project-queue.ts   # Per-project FIFO queue with concurrency control
│   │   └── __tests__/         # Queue unit tests
│   │
│   ├── config/                # Configuration system
│   │   └── loader.ts          # YAML config parser and loader
│   │
│   ├── types/                 # TypeScript type definitions
│   │   └── index.ts           # Zod schemas and types
│   │
│   ├── utils/                 # Shared utilities
│   │   └── logger.ts          # Winston structured logging
│   │
│   └── index.ts               # Application entry point
│
├── dist/                       # Compiled JavaScript (generated)
├── node_modules/              # Dependencies
├── tsconfig.json              # TypeScript configuration
├── package.json               # Project metadata & scripts
├── .gitignore                 # Git exclude patterns
└── .env.example               # Example environment variables
```

## Directory Purposes

### `/src/adapters/`
Normalizes messages from diverse channels into a unified format. Each adapter implements the `BaseAdapter` interface and handles channel-specific authentication, message formatting, and response delivery.

**Key Concepts:**
- `BaseAdapter` — Abstract class defining the adapter contract
- `AdapterManager` — Starts/stops all adapters and manages their lifecycle
- Channel-specific implementations (Slack, Discord, etc.) extend BaseAdapter

### `/src/agents/`
Manages agent discovery, execution, and coordination.

**Key Concepts:**
- `registry.ts` — Stores agent definitions (type, model preference, capabilities)
- `executor.ts` — Executes tasks through the model pipeline
- `builder-agent.ts` — Dynamically generates specialized agents for novel domains
- `p2p-router.ts` — Enables direct agent-to-agent communication for complex workflows

### `/src/router/`
The central hub that receives normalized messages from adapters and routes them to appropriate agents.

**Key Concepts:**
- `project-router.ts` — Receives messages, routes to agents, manages task lifecycle
- `project-creator.ts` — Initializes projects with their task queues and git repositories
- `registry.ts` — In-memory store of active projects and their metadata

### `/src/models/`
Implements the multi-stage model execution pipeline.

**Key Concepts:**
- `multi-stage.ts` — Orchestrates Claude → Codex → Gemini flow
- `router.ts` — Selects appropriate models based on task characteristics

### `/src/health/`
Comprehensive health monitoring and self-healing mechanisms.

**Key Concepts:**
- `daemon.ts` — Runs health checks on a schedule
- `circuit-breaker.ts` — Trips after 5 consecutive failures, auto-recovers
- `process-watcher.ts` — Detects zombie processes from crashed agents
- `ralph-loop.ts` — Detects stagnant tasks and triggers recovery
- `worktree.ts` — Manages git worktrees (one per task) for safe concurrent execution
- `task-discovery.ts` — Monitors active task execution

### `/src/queue/`
Per-project task queuing with configurable concurrency.

**Key Concepts:**
- Each project has its own FIFO queue
- Concurrency control prevents race conditions
- Tasks are dequeued and dispatched to agents

### `/src/config/`
Loads and parses YAML configuration files.

### `/src/types/`
Centralized TypeScript interfaces and Zod validation schemas for runtime type safety.

### `/src/utils/`
Shared utilities, primarily structured logging with Winston.

## Module Relationships

```
┌─────────────────────────────────────────────────────┐
│ index.ts (Application Entry)                        │
└──────────────┬──────────────────────────────────────┘
               │
      ┌────────┴────────────────┐
      ▼                         ▼
┌─────────────┐         ┌──────────────┐
│ Adapters    │         │ HealthDaemon │
│ (receive)   │         │ (monitor)    │
└──────┬──────┘         └──────┬───────┘
       │                       │
       │                ┌──────▼────────┐
       │                │ ProcessWatcher│
       │                │ CircuitBreaker│
       │                │ RalphLoop     │
       │                │ Worktree      │
       │                └───────────────┘
       │
       ▼
┌─────────────────┐
│ ProjectRouter   │ ◄─────── (coordinates)
│ (dispatch)      │
└────────┬────────┘
         │
    ┌────┴─────┐
    ▼          ▼
┌────────┐  ┌─────────┐
│ Queue  │  │ Agents  │
│ (FIFO) │  │(execute)│
└────────┘  └────┬────┘
                 │
                 ▼
          ┌─────────────┐
          │ Models      │
          │ (verify)    │
          └─────────────┘
```

## Architecture Layers

### 1. Adapter Layer (Input)
Receives user messages from external channels and normalizes them into a standard message format.

### 2. Router Layer (Dispatch)
Parses normalized messages, determines which agent should handle the task, and enqueues work.

### 3. Queue Layer (Serialization)
Maintains per-project FIFO queues with concurrency limits to prevent race conditions.

### 4. Agent Layer (Execution)
Executes tasks using the agent registry, calling the selected agent with task context.

### 5. Model Layer (Verification)
Routes agent output through multi-stage verification (Claude → Codex review → Gemini verify).

### 6. Health Layer (Reliability)
Monitors task execution, detects failures, manages circuit breakers, and initiates recovery.

### 7. Persistence Layer (Isolation)
Manages git worktrees per task and ensures clean, isolated execution environments.

## Key File Locations & Roles

| File | Purpose |
|------|---------|
| `src/index.ts` | Application bootstrap, initializes daemon, router, adapters |
| `src/router/project-router.ts` | Central message dispatcher and agent coordinator |
| `src/adapters/manager.ts` | Lifecycle management for all channel adapters |
| `src/agents/executor.ts` | Invokes agents and manages task execution flow |
| `src/health/daemon.ts` | Main health monitoring process |
| `src/health/worktree.ts` | Git worktree creation and cleanup |
| `src/queue/project-queue.ts` | Per-project task queue implementation |
| `src/models/multi-stage.ts` | Multi-stage model execution pipeline |
| `src/types/index.ts` | Zod schemas for all data structures |
