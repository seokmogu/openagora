# OpenAgora Entry Points

## Application Startup Sequence

### Stage 1: Process Bootstrap

```
node dist/index.js
  ├─ Load environment (dotenv)
  ├─ Parse command-line arguments (if any)
  └─ Call main() async function
```

**Entry File**: `src/index.ts`

```typescript
import 'dotenv/config';
import { loadConfig } from './config/loader.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  // ... initialization sequence
}

main().catch((err: unknown) => {
  logger.error('Fatal error', { error: err });
  process.exit(1);
});
```

**Key Environment Variables** (from `src/router/project-router.ts`):
- `BASE_PROJECT_DIR` (default: `/home/hackit/project`) — Root directory for created projects
- `GITHUB_USER` (default: `unknown`) — GitHub username for repo attribution

---

### Stage 2: Configuration Loading

```typescript
const config = await loadConfig();
```

**Source**: `src/config/loader.ts`

**Configuration Hierarchy**:
1. Environment variables (.env file via dotenv)
2. `.moai/config/sections/*.yaml` files
3. Hardcoded defaults

**AppConfig Structure**:
```typescript
interface AppConfig {
  registry: {
    projectsPath: string        // Path to project registry
  }
  health: {
    port: number                // Health HTTP endpoint port (default: 3000)
  }
  adapters: {
    slack?: { token: string; signingSecret: string }
    discord?: { token: string }
    telegram?: { token: string }
    email?: { imap: {...}; smtp: {...} }
    webhook?: { port: number }
    cli?: {}
  }
  models: {
    claude?: { apiKey: string }
    codex?: { apiKey: string }
    gemini?: { apiKey: string }
  }
}
```

---

### Stage 3: Health Daemon Initialization

```typescript
const health = new HealthDaemon(config);
```

**Order**: Initialized **first** because ProcessWatcher is a dependency of router.

**Responsibilities at Startup**:
1. Construct HealthMonitor
2. Construct ProcessWatcher (tracks agent subprocesses)
3. Construct Notifier (placeholder for alerts)
4. Construct TaskDiscovery (finds incomplete work)

**Not Started Yet**: start() is called later.

---

### Stage 4: ProjectRouter Initialization

```typescript
const router = new ProjectRouter(config, health.getProcessWatcher());
health.setRouter(router);
```

**Constructor Work**:
1. Construct ProjectRegistry (point to disk location)
2. Construct AgentRegistry (load builtin agents)
3. Construct ProjectCreator (for new project generation)
4. Construct ProjectQueue (per-project FIFO queues)
5. Construct AgentExecutor (spawn claude CLI)
6. Construct P2PRouter (DELEGATE block parsing)
7. Construct MultiStageOrchestrator (validation pipeline)

**Notes**:
- Registry NOT loaded yet (async)
- Queues empty
- No agents spawned

---

### Stage 5: Router Initialization (Async)

```typescript
router.setNotifier(health.getNotifier());
health.setDiscoveryCallback(task => router.handleDiscoveredTask(task));

await router.init();
```

**Work**:
1. Load ProjectRegistry from disk (async)
2. Log configuration
3. Set up cross-component callbacks

**After this**: Router ready to accept messages from adapters.

---

### Stage 6: Adapter Manager Startup

```typescript
const adapters = new AdapterManager(config, router);
await adapters.startAll();
```

**Source**: `src/adapters/manager.ts`

**Adapters Started** (in order):
1. Slack (Bolt App.start())
2. Discord (Discord.Client.login())
3. Telegram (Telegraf.launch())
4. Email (IMAP polling loop)
5. Webhook (Express.listen())
6. CLI (stdin listener)

**Each Adapter**:
- Connects to external service
- Begins listening for messages
- Registers handler with ProjectRouter

**Error Handling**: Non-fatal startup failures are logged but don't block others.

---

### Stage 7: Health Daemon Startup

```typescript
await health.start();
```

**Work**:
1. Start ProcessWatcher (monitor agent processes)
2. Start TaskDiscovery (scan for incomplete work)
3. Schedule periodic health checks (every 10 minutes)
4. Start HTTP health server (GET /health endpoint)
5. Run initial health check immediately

---

### Stage 8: Shutdown Handler Installation

```typescript
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down...`);
  await adapters.stopAll();
  await health.stop();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

**Graceful Shutdown Sequence**:
1. SIGTERM or SIGINT received
2. Stop all adapters (drain queues, close connections)
3. Stop health daemon (kill HTTP server, stop monitoring)
4. Exit process cleanly (code 0)

**No Task Cleanup**: Queued but not-yet-started tasks are lost. Already-executing agents are killed by ProcessWatcher.

---

### Stage 9: Ready to Accept Work

```
logger.info('OpenAgora started', { version: '0.1.0' });
```

System is now ready:
- All adapters listening
- Router initialized with projects from disk
- Health checks running
- Shutdown handlers installed
- Process stays alive until SIGTERM/SIGINT

---

## Message Processing Entry Points

### 1. Channel Adapter Message Ingestion

**Slack** (`src/adapters/slack.ts`):
```typescript
app.message(async (message) => {
  const channelMessage = normalizeSlackMessage(message);
  await router.handleMessage(channelMessage);
});
```

**Discord** (`src/adapters/discord.ts`):
```typescript
client.on('messageCreate', async (message) => {
  const channelMessage = normalizeDiscordMessage(message);
  await router.handleMessage(channelMessage);
});
```

**Similar for**: Telegram, Email, Webhook, CLI

**Output**: All adapters produce `ChannelMessage` → pass to `router.handleMessage()`

---

### 2. ProjectRouter.handleMessage()

**Source**: `src/router/project-router.ts` (line 61)

**Execution Flow**:
```
handleMessage(message: ChannelMessage)
  ├─ 1. Match or create project
  │    ├─ Match: projectRegistry.matchProject(content)
  │    └─ Create: if not found, creator.create({...})
  │
  ├─ 2. Get agent for domain
  │    ├─ Detect domain (AgentExecutor.detectDomain)
  │    ├─ Registry.getAgentForDomain(domain)
  │    └─ BuilderAgent.create() if domain=general && substantial
  │
  ├─ 3. Enqueue task
  │    └─ queue.enqueue(projectId, message, executeJob)
  │
  └─ 4. Execute async (when queue pops)
       └─ orchestrator.run(task, agentId, projectPath, domain)
```

**Concurrency**: One job per project at a time (FIFO per project).

**Error Handling**: All exceptions caught; reply sent to user.

---

### 3. Agent Execution Pipeline

**Source**: `src/agents/executor.ts` (line 22)

**Entry**: `AgentExecutor.run(task, agentId, projectPath)`

```
AgentExecutor.run()
  ├─ Check circuit breaker (if open, reject)
  ├─ Build prompt from task.message.content
  ├─ Create git worktree (P4 isolation)
  ├─ Spawn 'claude' CLI subprocess
  │  ├─ Args: ['-p', '--agent', agentId, '--dangerously-skip-permissions', prompt]
  │  └─ CWD: projectPath (or worktree)
  ├─ Attach stdout/stderr listeners
  ├─ Set 30-minute timeout
  ├─ Record result (success/failure)
  ├─ Record circuit breaker state
  ├─ Remove worktree (cleanup)
  └─ Return ExecutionResult
```

**Timeout**: 30 minutes per task (TIMEOUT_MS = 1800000)

**Process Isolation**:
- Spawned with `detached: true` (process group isolation)
- Timeout → `process.kill(-pid, 'SIGKILL')` (kill entire group)
- ProcessWatcher tracks and can force-kill on health check

---

### 4. Health Daemon Monitoring Loop

**Source**: `src/health/daemon.ts` (line 43)

**Trigger**: Every 10 minutes (HEALTH_INTERVAL_MS = 600000)

```
setInterval(() => runCheck(), 10 minutes)
  └─ HealthMonitor.check()
     ├─ Get active projects from router
     ├─ Get queue stats from router
     ├─ Compute CircuitBreaker states
     ├─ Return HealthStatus JSON
     └─ Log results

Parallel:
TaskDiscovery.check()
  ├─ Scan project directories for incomplete work
  ├─ Re-enqueue discovered tasks
  └─ Call router.handleDiscoveredTask()

ProcessWatcher.check()
  ├─ Track spawned agent processes
  ├─ Detect timeouts (30min per task)
  └─ Force-kill with SIGKILL if timeout exceeded
```

---

### 5. Health HTTP Endpoint

**Source**: `src/health/daemon.ts` (line 109)

**Endpoint**: GET `/health`

**Response**:
```json
{
  "healthy": true,
  "uptime": 3600000,
  "activeProjects": 2,
  "queueDepth": 1,
  "circuitBreakers": {
    "expert-developer": "closed",
    "expert-analyst": "half-open"
  },
  "lastCheck": "2026-03-21T12:34:56Z"
}
```

**Usage**: Load balancers, monitoring systems (Prometheus, Datadog, etc.)

---

### 6. Task Discovery Callback

**Source**: `src/health/task-discovery.ts`

**Trigger**: Periodic scan (every 10 minutes, same as health check)

**Discovery Logic**:
1. Scan each active project directory
2. Look for `.task` or `incomplete-*` markers
3. If found, infer task content and re-enqueue

**Callback**:
```typescript
health.setDiscoveryCallback(task => router.handleDiscoveredTask(task));
```

**Synthetic Message Created**:
```typescript
const syntheticMessage: ChannelMessage = {
  id: `discovery-${Date.now()}`,
  channel: 'cli',
  channelId: 'discovery',
  userId: 'system',
  content: task.content,
  timestamp: new Date(),
  replyFn: async (reply) => { /* log reply */ }
}
```

**Solves P3**: Work continuation across heartbeat intervals.

---

## CLI Adapter Entry Point

**Source**: `src/adapters/cli.ts`

**Usage**:
```bash
openagora --task "Build a REST API in Node.js"
# OR
echo "Fix the login bug" | openagora
```

**Flow**:
1. Read from command-line arg or stdin
2. Create ChannelMessage with channel='cli'
3. Pass to router.handleMessage()
4. Print result to stdout (blocking until complete)

**Purpose**: Local testing and integration with shell scripts.

---

## Environment-Based Conditional Initialization

### Adapter Activation

In `src/adapters/manager.ts`:
```typescript
async startAll(): Promise<void> {
  if (config.adapters.slack) await this.slack.start();
  if (config.adapters.discord) await this.discord.start();
  // ... etc
}
```

**Disabled adapters**: Not instantiated, no resource usage.

### Model Router Activation

In `src/models/router.ts`:
```typescript
const routes = this.loadRoutesFromConfig();
// If codex endpoint not configured, review stage skipped
// If gemini endpoint not configured, verify stage skipped
```

**Multi-stage Flexibility**: Any stage can be disabled via config.

---

## Signal Handlers

### SIGTERM (Graceful Shutdown)

Typically sent by:
- systemd stopping the service
- Kubernetes pod eviction
- Container orchestration platforms

**Action**: Graceful shutdown sequence (see Stage 8 above).

### SIGINT (Ctrl+C)

Typically sent by:
- User pressing Ctrl+C in terminal
- IDE "stop" button

**Action**: Same as SIGTERM.

### SIGKILL (Force Kill)

**Not Caught** (non-catchable signal). Used by ProcessWatcher to force-kill agent subprocesses on timeout.

---

## Startup Checklist

Before system is ready:
- [ ] .env file present (or env vars set)
- [ ] .moai/config/sections/*.yaml files exist
- [ ] Registry directory writable (for project creation)
- [ ] Project base directory exists (BASE_PROJECT_DIR)
- [ ] Slack/Discord/Telegram tokens set (if adapters enabled)
- [ ] Health port available (default 3000)
- [ ] Node.js 20+ installed
- [ ] Git installed (for project creation, worktrees)

---

**Version**: 0.1.0
**Last Updated**: 2026-03-21
