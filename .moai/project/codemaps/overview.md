# OpenAgora Architecture Overview

## System Identity

OpenAgora is a multi-agent orchestration platform that coordinates Claude agents across multiple communication channels. The system uses event-driven architecture with plugin-based adapters, enabling seamless task routing and execution across Slack, Discord, Telegram, Email, Webhooks, and CLI.

## Core Design Patterns

### 1. Event-Driven Architecture

All incoming messages flow through a normalized event pipeline:

```
Channel Input (Slack/Discord/etc.)
    ↓
[Adapter] Normalizes to ChannelMessage
    ↓
[ProjectRouter] Dispatches to project-specific queue
    ↓
[ProjectQueue] FIFO task processing per project
    ↓
[AgentExecutor] Subprocess execution with timeouts
    ↓
Channel Output (via replyFn)
```

The event-driven design enables:
- Decoupling of input channels from business logic
- Asynchronous task processing without blocking
- Per-project isolation and priority management

### 2. Plugin Architecture (Adapter Pattern)

**AdapterManager** orchestrates 6 pluggable channel adapters:
- SlackAdapter (requires SLACK_BOT_TOKEN)
- DiscordAdapter (requires DISCORD_BOT_TOKEN)
- TelegramAdapter (requires TELEGRAM_BOT_TOKEN)
- EmailAdapter (requires EMAIL_IMAP_HOST)
- WebhookAdapter (always enabled)
- CliAdapter (always enabled)

Each adapter:
- Inherits from `BaseAdapter` interface
- Implements `start()` / `stop()` lifecycle
- Normalizes channel-specific messages to `ChannelMessage` type
- Calls a shared `handleMessage()` callback via `setHandler()`

Adapters are instantiated conditionally based on environment variables, enabling zero-configuration for unused channels.

### 3. Strategy Pattern (Model Routing)

**ModelRouter** implements strategy pattern for domain-aware model selection:

```
Task Domain (development | database | analysis | research | writing | planning | general)
    ↓
[ModelRouter] Maps to Capability (best-coding | best-analysis | best-writing | etc.)
    ↓
[MultiStageOrchestrator] Selects Primary Model → Review Model → Verify Model
    ↓
[AgentExecutor] Spawns claude CLI subprocess
```

Strategies:
- **Primary Stage**: Executes main agent (Claude)
- **Review Stage**: Optional secondary validation (Codex/GPT)
- **Verify Stage**: Optional tertiary confirmation (Gemini)

The strategy routing enables:
- Domain-specific model optimization
- Fallback handling when models unavailable
- Quality gates based on task complexity

### 4. Circuit Breaker Pattern (Fault Tolerance)

**CircuitBreaker** protects against cascading failures:

```
Success Path:   CLOSED → success() → stays CLOSED
Failure Path:   CLOSED → fail() → (5 failures) → OPEN
Recovery Path:  OPEN → (timeout) → HALF_OPEN → success() → CLOSED
                HALF_OPEN → fail() → OPEN
```

Per-agent circuit breakers prevent:
- Repeated execution of failing agents
- Resource exhaustion from failed subprocesses
- Cascading failures across orchestrator

## System Layers

### Layer 1: Channel Adapters (Input)

**Responsibility**: Normalize messages from external channels

**Key Classes**:
- `BaseAdapter` - Abstract interface
- `SlackAdapter`, `DiscordAdapter`, etc. - Concrete implementations
- `AdapterManager` - Lifecycle management

**Characteristics**:
- Stateless message transformation
- No business logic (pure I/O)
- Concurrent adapter execution

### Layer 2: Project Router (Routing)

**Responsibility**: Route messages to correct project, create projects, parse commands

**Key Classes**:
- `ProjectRouter` - Central dispatch hub
- `ProjectRegistry` - In-memory project catalog
- `ProjectCreator` - Dynamic project initialization
- `CommandParser` - Parse `/run` `/setup` commands

**Characteristics**:
- Single point of entry for all messages
- Manages project lifecycle (create, list, query)
- Integrates with health daemon for process monitoring

### Layer 3: Task Queue (Buffering)

**Responsibility**: FIFO task buffering per project, priority ordering

**Key Classes**:
- `ProjectQueue` - Map of project queues
- `QueuedTask` - Task envelope with priority + status

**Characteristics**:
- Per-project isolation (no cross-project interference)
- Priority ordering within project
- Status tracking (pending → running → completed/failed)

### Layer 4: Agent Execution (Processing)

**Responsibility**: Spawn agent processes, manage timeouts, track circuit breakers

**Key Classes**:
- `AgentExecutor` - Process spawner
- `CircuitBreakerRegistry` - Per-agent fault protection
- `ProcessWatcher` - Lifecycle monitoring
- `WorktreeManager` - Git worktree isolation

**Characteristics**:
- 30-minute timeout per task
- Circuit breaker prevents retry storms
- Subprocess stdout/stderr captured
- Git worktree isolation for agent-specific code

### Layer 5: Model Orchestration (Quality)

**Responsibility**: Multi-stage execution, convergence detection, fallback handling

**Key Classes**:
- `MultiStageOrchestrator` - 3-stage pipeline (Primary → Review → Verify)
- `ModelRouter` - Domain-to-capability mapping
- `RalphLoop` - Stagnation detection
- `P2PRouter` - Agent-to-agent messaging

**Characteristics**:
- Primary stage always executes
- Review/Verify stages conditional (timeout-gated at 5 min each)
- Ralph Loop detects and breaks infinite loops
- Converges when: verified OR quality gates met OR stagnation detected

### Layer 6: Health Monitoring (Observability)

**Responsibility**: Process health, circuit breaker status, task discovery

**Key Classes**:
- `HealthDaemon` - Orchestrates health checks
- `HealthMonitor` - Status aggregation
- `ProcessWatcher` - Track spawned processes
- `TaskDiscovery` - Find orphaned/stalled tasks
- `Notifier` - Alert on health state changes

**Characteristics**:
- 10-minute check interval
- HTTP health endpoint (port 3001)
- Automatic SIGKILL on 30-min timeout
- Discovers and recovers orphaned tasks

## Data Flow (Request → Response)

```
1. User Message (Slack/Discord/etc.)
   ↓
2. Adapter.handleMessage(msg)
   ↓
3. ProjectRouter.handleMessage(channelMessage)
   ↓
4. ProjectRegistry.getOrCreate(projectId)
   ↓
5. ProjectQueue.enqueue(task)
   ↓
6. [Dequeue] ProjectQueue.dequeue()
   ↓
7. AgentExecutor.run(task, agentId, projectPath)
   ↓
8. [Subprocess] claude CLI with prompt (30 min timeout)
   ↓
9. MultiStageOrchestrator.executeStages(task)
   - Primary stage: execute agent
   - Review stage: validate (if not timeout)
   - Verify stage: confirm (if not timeout)
   ↓
10. [Success/Failure] Record result in task status
   ↓
11. Message.replyFn(result) → back to user channel
```

## External Integration Points

### Runtime Dependencies

**Communication Channels**:
- `@slack/bolt` - Slack Bot API
- `discord.js` - Discord Bot API
- `telegraf` - Telegram Bot API
- `nodemailer` + `imapflow` - Email (SMTP/IMAP)
- `express` - HTTP webhook server

**Utilities**:
- `simple-git` - Git operations (worktree management)
- `p-queue` - Task queue management
- `winston` - Structured logging
- `zod` - Runtime schema validation
- `yaml` - Config file parsing
- `dotenv` - Environment variable loading

### Environment Configuration

```
SLACK_BOT_TOKEN       # Enable SlackAdapter
DISCORD_BOT_TOKEN     # Enable DiscordAdapter
TELEGRAM_BOT_TOKEN    # Enable TelegramAdapter
EMAIL_IMAP_HOST       # Enable EmailAdapter
GITHUB_USER           # GitHub username (for repos)
CLAUDE_API_KEY        # Claude CLI auth
```

## Key Invariants

1. **Project Isolation**: Tasks from different projects never interfere
2. **Process Containment**: Each agent runs in isolated subprocess with hard 30-min timeout
3. **Circuit Breaker Protection**: Failing agents are rapidly rejected after 5 consecutive failures
4. **Convergence Guarantee**: Multi-stage pipeline always terminates (Ralph Loop prevents infinite loops)
5. **Health Visibility**: All failures are discoverable via health endpoint and task discovery
6. **Message Atomicity**: Each message is processed exactly once (idempotent handlers)

## Error Handling Strategy

```
Error Type                      Handler
─────────────────────────────────────────────────────────
Adapter failure                 Log warning, skip adapter, continue
Project creation failure        Reply to user, don't enqueue task
Agent timeout (30 min)          ProcessWatcher SIGKILL, mark task failed
Circuit breaker open            Immediately reject, don't spawn
Multi-stage convergence fail    Log warning, return best result
Health daemon failure           Log error, continue checks
```

## Extensibility Points

1. **Add New Channel**: Create `src/adapters/NewChannelAdapter.ts`, instantiate in `AdapterManager`
2. **Add New Agent Type**: Create agent definition in `.claude/agents/moai/`, register in `AgentRegistry`
3. **Add New Model Strategy**: Extend `ModelRouter` with domain → capability mapping
4. **Custom Health Checks**: Register custom check in `HealthMonitor.registerCheck()`
5. **Worktree Strategies**: Extend `WorktreeManager` for custom isolation policies

## Version & Tooling

- **TypeScript**: 5.7+
- **Runtime**: Node.js 22 (ESM)
- **Testing**: Vitest with 85%+ coverage target
- **Linting**: ESLint 9 with strict TypeScript rules
- **Build**: `tsc` for compilation, `tsx` for dev watching
