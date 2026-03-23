# OpenAgora Entry Points

## Primary Entry Points

### 1. Main Application Server (src/index.ts)

**Command**: `npm start` or `node dist/index.js`

**Execution Flow**:

```typescript
main()
  ↓
1. loadConfig() → Read YAML + env vars
  ↓
2. HealthDaemon(config) → Create health daemon
  ↓
3. ProjectRouter(config, processWatcher) → Create router
  ↓
4. AdapterManager(config, router) → Create adapters
  ↓
5. router.init() → Load project registry + agents
  ↓
6. adapters.startAll() → Start all active adapters
  ↓
7. health.start() → Start health checks + HTTP server
  ↓
8. logger.info('OpenAgora started') → Ready for messages
  ↓
9. Wait for SIGTERM/SIGINT → Graceful shutdown
  ↓
10. adapters.stopAll() → Close all channels
  ↓
11. health.stop() → Stop health daemon
  ↓
12. process.exit(0)
```

**Startup Sequence Invariants**:

1. **Health owns ProcessWatcher**: Created first so all subprocesses can be tracked
2. **Router created before adapters**: Router must be ready to handle first message
3. **Init before listening**: Load projects + agents before starting adapters
4. **Adapters start in parallel**: Multiple adapters start concurrently
5. **Health starts last**: Ensures all components running before first health check

**Shutdown Sequence**:

1. Stop all adapters (disconnect from channels)
2. Stop health daemon (stop subprocess tracking)
3. Process exit with status 0

**Exit Codes**:

| Code | Meaning |
|------|---------|
| 0 | Graceful shutdown |
| 1 | Fatal error in main() (logged) |

**Configuration Required**:

- `config.yaml` in current working directory or via CONFIG_PATH env
- One or more adapters enabled (via env vars)

**Environment Variables**:

```bash
SLACK_BOT_TOKEN          # Enable Slack adapter
DISCORD_BOT_TOKEN        # Enable Discord adapter
TELEGRAM_BOT_TOKEN       # Enable Telegram adapter
EMAIL_IMAP_HOST          # Enable Email adapter
GITHUB_USER              # GitHub username (for repos)
CLAUDE_API_KEY           # Claude CLI authentication
LOG_LEVEL                # Winston log level (default: info)
REGISTRY_PATH            # Projects registry path (default: ./registry)
HEALTH_PORT              # Health endpoint port (default: 3001)
WEBHOOK_PORT             # Webhook adapter port (default: 3000)
```

**Typical Startup Output** (via Winston logger):

```
info: Loaded config from config.yaml { timestamp: '2026-03-23T...' }
info: Health daemon starting { healthPort: 3001, intervalMs: 600000 }
info: AdapterManager: starting all adapters { count: 3, types: [ 'slack', 'webhook', 'cli' ] }
info: SlackAdapter: connected { team_id: 'T...' }
info: WebhookAdapter: listening on port 3000 { path: '/webhook' }
info: CliAdapter: ready for stdin
info: OpenAgora started { version: '0.1.0' }
```

### 2. CLI Interface (src/cli/main.ts)

**Command**: `npm run cli [subcommand] [options]`

**Entry Point**: `bin/openagora.js` (after build)

**Execution Flow**:

```typescript
main(argv)
  ↓
1. Parse argv with minimist or similar
  ↓
2. Route to subcommand handler:
   - setup         → Interactive configuration wizard
   - token [type]  → Generate API token
   - list          → List projects in registry
   - config        → Show current configuration
   - help          → Display help message
  ↓
3. Execute subcommand
  ↓
4. Log result or error
  ↓
5. process.exit(0 or 1)
```

**Subcommands**:

| Subcommand | Handler | Purpose |
|-----------|---------|---------|
| `npm run cli setup` | `setup.ts` | Interactive configuration wizard |
| `npm run cli:setup` | `setup.ts` | Alias for setup |
| `npm run cli token` | `tokens.ts` | Generate Claude API token |
| `npm run cli list` | `main.ts` | List projects in registry |
| `npm run cli config` | `env-manager.ts` | Display configuration |

**Exit Codes**:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Configuration error |
| 2 | Invalid subcommand |

**Example Invocations**:

```bash
# Interactive setup
npm run cli:setup

# List projects
npm run cli list

# Generate token
npm run cli token claude

# Show configuration
npm run cli config
```

## Secondary Entry Points

### 3. Webhook Adapter (src/adapters/webhook.ts)

**Port**: 3000 (configurable via WEBHOOK_PORT env)

**Endpoint**: `POST /webhook`

**Request Format** (JSON):

```json
{
  "channel": "string",
  "userId": "string",
  "content": "string",
  "metadata": {
    "custom": "fields"
  }
}
```

**Response Format** (JSON):

```json
{
  "success": true,
  "taskId": "task-uuid",
  "message": "Task enqueued"
}
```

**Error Response**:

```json
{
  "success": false,
  "error": "Missing required field: content"
}
```

**Example cURL**:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "webhook",
    "userId": "user-123",
    "content": "/run my-project Implement feature X"
  }'
```

### 4. Health Endpoint (src/health/daemon.ts)

**Port**: 3001 (configurable via HEALTH_PORT env)

**Endpoint**: `GET /health`

**Response Format** (JSON):

```json
{
  "healthy": true,
  "uptime": 3600000,
  "activeProjects": 5,
  "queueDepth": 12,
  "circuitBreakers": {
    "agent-1": "closed",
    "agent-2": "open",
    "agent-3": "half-open"
  },
  "lastCheck": "2026-03-23T10:30:00Z"
}
```

**Health Status Interpretation**:

- `healthy: true` - All systems operational
- `healthy: false` - One or more circuit breakers open, or queue backlog > threshold
- `circuitBreakers` - Individual agent fault status
- `queueDepth` - Total pending tasks across all projects

**Example cURL**:

```bash
curl http://localhost:3001/health | jq '.'
```

**Monitoring Integration**:

- Prometheus scrape: `GET /health` (every 30 seconds)
- Kubernetes liveness probe: `GET /health` (should return 200 if healthy)
- Datadog/CloudWatch: Poll `/health` for dashboard metrics

## Configuration Loading Flow

**Entry point**: `src/config/loader.ts`

**Loading sequence**:

```
1. Check process.env.CONFIG_PATH
   ↓
2. If not set, use ./config.yaml (current directory)
   ↓
3. Load YAML file (sync fs.readFileSync)
   ↓
4. Merge with environment variables:
   - SLACK_BOT_TOKEN
   - DISCORD_BOT_TOKEN
   - TELEGRAM_BOT_TOKEN
   - EMAIL_IMAP_HOST
   - GITHUB_USER
   - CLAUDE_API_KEY
   ↓
5. Validate with Zod schema (AppConfig)
   ↓
6. Return validated AppConfig object
   ↓
7. On validation error: throw ZodError with field list
```

**Config file structure** (YAML):

```yaml
registry:
  projectsPath: ./registry/projects.json
  agentsPath: ./registry/agents.json

health:
  port: 3001
  interval: 600000  # 10 minutes in ms

adapters:
  webhook:
    port: 3000
  slack:
    logLevel: info
  discord:
    intents: ['GUILDS', 'GUILD_MESSAGES']
  # ... other adapter configs

models:
  domain_capabilities:
    development: best-coding
    analysis: best-analysis
    writing: best-writing
    # ... other domains
```

## Agent Execution Flow

**Entry point**: `src/agents/executor.ts` via `MultiStageOrchestrator.executeStages()`

**Subprocess spawning**:

```
1. Check circuit breaker for agent
   ↓ (if open: reject immediately)
2. Build prompt from task context
   ↓
3. Spawn subprocess: `claude --api-key $CLAUDE_API_KEY --prompt "..."`
   ↓
4. Set 30-minute timeout via ProcessWatcher
   ↓
5. Capture stdout to variable
   ↓
6. Wait for process exit (or timeout)
   ↓
7. Record success/failure in CircuitBreaker
   ↓
8. Return ExecutionResult {
     taskId, agentId, success, output, durationMs
   }
```

**Subprocess I/O**:

- **stdin**: Not used (non-interactive)
- **stdout**: Captured to result.output
- **stderr**: Captured to result.output
- **exit code**: 0 = success, non-zero = failure

**Environment Passed to Subprocess**:

```bash
CLAUDE_API_KEY         # (from parent)
PROJECT_PATH           # (task context)
TASK_ID                # (task context)
LOG_LEVEL              # (inherited)
```

## Graceful Shutdown Flow

**Triggers**: SIGTERM or SIGINT (Ctrl+C)

**Shutdown sequence**:

```
1. Signal handler: shutdown('SIGTERM')
  ↓
2. adapters.stopAll()
   - SlackAdapter: app.stop()
   - DiscordAdapter: client.destroy()
   - TelegramAdapter: bot.stop()
   - EmailAdapter: close IMAP connection
   - WebhookAdapter: server.close()
   - CliAdapter: close stdin
  ↓
3. health.stop()
   - Clear interval timer
   - Close HTTP server
   - Stop ProcessWatcher
  ↓
4. logger.info('Shutdown complete')
  ↓
5. process.exit(0)
```

**Max shutdown time**: 5 seconds before forced exit

## Error Handling at Entry Points

### Main Application (index.ts)

```typescript
try {
  await main();
} catch (err) {
  logger.error('Fatal error', { error: err });
  process.exit(1);
}
```

**Fatal errors**:
- Config loading fails (missing required env vars)
- Adapter binding fails (invalid token)
- Port already in use (WebhookAdapter)

### CLI (cli/main.ts)

```typescript
try {
  // execute command
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
```

**Common errors**:
- Invalid subcommand
- Config file not found
- Insufficient permissions

### Webhook Endpoint (adapters/webhook.ts)

```typescript
try {
  // validate request
  // enqueue task
  res.json({ success: true, taskId });
} catch (err) {
  logger.warn('Webhook error', { error: err });
  res.status(400).json({ success: false, error: err.message });
}
```

**HTTP status codes**:
- 200 - Task enqueued successfully
- 400 - Invalid request format
- 500 - Internal server error

## Performance Characteristics

### Startup Time

- **Typical**: 2-3 seconds
- **With slow registry**: 5-10 seconds
- **First adapter connection**: +2 seconds (Slack/Discord handshake)

### Memory Usage

- **Baseline**: 80-100 MB
- **Per active project**: +5-10 MB
- **Per queued task**: +1-2 MB
- **Peak with 100 projects + 1000 tasks**: ~500 MB

### Throughput

- **Messages per second**: 100+ (limited by adapter I/O)
- **Concurrent agent executions**: 10+ (per CPU core)
- **Queue latency**: <100ms for local projects

## Monitoring & Debugging

### Log Levels

Set via `LOG_LEVEL` env or config:

```bash
LOG_LEVEL=debug npm start
```

Available: error, warn, info (default), debug, trace

### Debug Endpoints

- `GET /health` - System status
- `GET /health/processes` - Active subprocess list
- `GET /health/queue` - Pending tasks per project

### Debugging Individual Flows

```bash
# Trace adapter startup
LOG_LEVEL=debug npm start

# Trace agent execution
LOG_LEVEL=debug npm start 2>&1 | grep "AgentExecutor"

# Trace health checks
LOG_LEVEL=debug npm start 2>&1 | grep "HealthDaemon"
```
