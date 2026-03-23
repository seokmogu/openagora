# OpenAgora — Multi-Agent Orchestration Platform

> Open multi-agent orchestration platform for planning, development, research, analysis, and academic writing.

OpenAgora is an intelligent system that coordinates specialized AI agents across multiple models and channels to solve complex tasks autonomously. It integrates Claude, Codex, Gemini, Perplexity, and other state-of-the-art AI models with real-time communication channels (Slack, Discord, Telegram) and external tools (GitHub, Notion, web search).

---

## Quick Start

### Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **Claude CLI** (authenticated) ([install guide](https://docs.anthropic.com/en/docs/claude-code))

### 3 Commands to Start

```bash
git clone https://github.com/seokmogu/openagora && cd openagora
npm install && npm run build
npm start
```

OpenAgora starts in **CLI mode** — type your task directly in the terminal. No API keys or channel tokens needed.

### Optional: Add Channel Integrations

To connect Slack, Discord, or Telegram, run the setup wizard:

```bash
openagora setup
```

Or manually create `.env` and add your tokens:

```bash
cp .env.example .env
# Edit .env with your channel tokens
```

See [Channel Configuration](#channel-configuration) below for details.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHANNEL ADAPTER                               │
│  Slack / Discord / Telegram / Email / Webhook / CLI             │
│  → Normalize by channel → Route to project FIFO queue           │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  PROJECT ROUTER                                   │
│  Look up project registry → Route to project workspace           │
│  Auto-create new projects with git repo                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│               AGENT ORCHESTRATION                                 │
│                                                                  │
│  ┌─ Manager Agents ────────────────────────────────────────┐    │
│  │  project / spec / strategy / git / docs / quality       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Expert Agents (dynamically created) ────────────────────┐   │
│  │  backend / frontend / security / devops / testing        │    │
│  │  + planner / analyst / researcher / writer / dba         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Builder Agents ────────────────────────────────────────┐    │
│  │  Create new agents, skills, MCP plugins on-demand       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Team Agents (P2P communication) ────────────────────────┐   │
│  │  Git worktree isolation + direct message passing         │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   MULTI-MODEL ROUTER                             │
│                                                                  │
│  Code Implementation    → Claude Sonnet/Opus                   │
│  Code Review           → Codex (GPT, via CLI)                  │
│  Final Verification    → Gemini API                            │
│  Image Generation      → DALL-E 3 / Midjourney / Flux          │
│  UI Design             → Vercel v0                             │
│  Research              → Perplexity API                        │
│  Writing/Essays        → Claude Opus                           │
│  Data Analysis         → Gemini / GPT-4o Code Interpreter     │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  HEALTH & LOOP ENGINE                            │
│                                                                  │
│  Ralph Loop: Detect stagnation (exit if no improvement)        │
│  Circuit Breaker: 5 failures → auto-shutdown                   │
│  Quality Gates: LSP checks + coverage thresholds               │
│  Graceful Termination: max-runs + max-cost + max-duration      │
│  SIGKILL: 30s timeout → force terminate process group          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Channel Setup

### Slack

1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode (Apps > Your App > Socket Mode)
3. Copy the **App Token** (starts with `xapp-`)
4. Go to OAuth & Permissions
5. Add these Bot Token Scopes:
   - `chat:write`
   - `commands`
   - `app_mentions:read`
   - `message.channels`
   - `message.groups`
   - `message.im`
6. Copy the **Bot Token** (starts with `xoxb-`)
7. Add to your workspace

### Discord

1. Create an application at https://discord.com/developers/applications
2. Create a Bot and copy the token
3. Set intents: `MESSAGE_CONTENT`, `GUILD_MESSAGES`, `DIRECT_MESSAGES`
4. Add to your server with `bot` scope and `send_messages` permission

### Telegram

1. Create a bot with @BotFather on Telegram
2. Copy the token

### Webhook

Receive JSON payloads at `http://your-server:3000/webhook`:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-secret-here" \
  -d '{
    "project": "myproject",
    "task": "implement feature X",
    "priority": "high"
  }'
```

---

## Project Management Commands

### Via CLI

```bash
# List all projects
openagora projects list

# Create a new project
openagora project create myproject

# Run a task
openagora run myproject "implement login system"

# Check project status
openagora project status myproject

# View project logs
openagora logs myproject --follow
```

### Via Slack

```
@openagora run myproject "implement login system"
@openagora status myproject
@openagora list projects
```

### Via Discord

```
!openagora run myproject "implement login system"
!openagora status myproject
```

---

## Configuration Files

### `config/channels.yaml`
Defines which communication channels are enabled and their configuration.

### `config/models.yaml`
Specifies AI model capabilities and assignments:
- Best coding: Claude (primary), Codex (review), Gemini (verify)
- Best writing: Claude Opus
- Best research: Perplexity (search), Claude Opus (synthesis)
- Best image: Midjourney (primary), DALL-E 3 (fallback)

### `config/mcp.json`
MCP server configurations for:
- Notion (document management)
- GitHub (repository access)
- Sequential Thinking (complex analysis)
- Memory (persistent knowledge)
- Exa (web search)
- Firecrawl (web scraping)
- Playwright (browser automation)
- Context7 (API documentation)

---

## Development Guide

### Project Structure

```
openagora/
├── src/
│   ├── channels/          # Channel adapters (Slack, Discord, etc)
│   ├── agents/            # Agent implementations
│   ├── models/            # AI model integrations
│   ├── registry/          # Project and agent registry
│   └── health/            # Health checks and monitoring
├── config/                # Configuration files
├── dist/                  # Compiled output
├── logs/                  # Application logs
├── registry/              # Runtime registry database
└── docs/                  # Documentation
```

### Building

```bash
# Development build
npm run build

# Watch mode
npm run watch

# Production build
npm run build --production
```

### Testing

**Current coverage: 25 test files, 232 tests** (SPEC-TEST-001)

Test suites:
- Core: AgentExecutor, MultiStageOrchestrator, AdapterManager, HealthDaemon, ProjectRouter
- Adapters: Slack, Discord, Webhook, Base, Telegram, CLI
- Agents: AgentRegistry, P2PRouter
- Health: RalphLoop, Notifier, HealthMonitor, WorktreeManager, ProcessWatcher, TaskDiscovery
- Config: loader, ProjectRegistry, ProjectCreator, ModelRouter

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Adding a New Agent

1. Create agent definition in `.claude/agents/moai/`
2. Implement agent class in `src/agents/`
3. Register in agent registry
4. Add MCP servers if needed

### Adding a New Channel

1. Create adapter in `src/channels/`
2. Implement channel interface (send/receive)
3. Add configuration to `config/channels.yaml`
4. Register in channel manager

---

## Deployment

### Docker

```bash
# Build image
docker build -t openagora:latest .

# Run container
docker run -d \
  --name openagora \
  --restart unless-stopped \
  --network host \
  -v $HOME/project:$HOME/project \
  -v $HOME/.claude:$HOME/.claude:ro \
  --env-file .env \
  openagora:latest
```

### Docker Compose

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f openagora

# Stop services
docker-compose down
```

### Systemd

```bash
# Install service
sudo cp openagora.service /etc/systemd/system/

# Enable auto-start
sudo systemctl enable openagora

# Start service
sudo systemctl start openagora

# View logs
sudo journalctl -u openagora -f
```

---

## Monitoring

### Health Check

```bash
# Local
curl http://localhost:3001/health

# Docker
curl http://localhost:3001/health
```

### Logs

```bash
# Local
tail -f logs/openagora.log

# Docker Compose
docker-compose logs -f openagora

# Systemd
journalctl -u openagora -f
```

### Metrics

Access metrics endpoint at `http://localhost:3001/metrics`:
- Active agents
- Message queue depth
- Model API latency
- Error rates by channel

---

## Environment Variables

Essential variables in `.env`:

```
# API Keys
ANTHROPIC_API_KEY          # Claude API key
GEMINI_API_KEY             # Google Gemini API
OPENAI_API_KEY             # OpenAI (DALL-E, GPT)
PERPLEXITY_API_KEY         # Perplexity research API

# Channels
SLACK_BOT_TOKEN            # Slack app bot token
SLACK_APP_TOKEN            # Slack Socket Mode token
DISCORD_BOT_TOKEN          # Discord bot token
TELEGRAM_BOT_TOKEN         # Telegram bot token
WEBHOOK_SECRET             # Webhook authentication secret

# GitHub
GITHUB_TOKEN               # GitHub personal access token
GITHUB_USER                # GitHub username

# External Tools
NOTION_API_KEY             # Notion database access
EXA_API_KEY                # Exa search API
FIRECRAWL_API_KEY          # Firecrawl web scraper

# System
NODE_ENV                   # production or development
LOG_LEVEL                  # debug, info, warn, error
BASE_PROJECT_DIR           # ~/project (defaults to $HOME/project)
HEALTH_PORT                # 3001
WEBHOOK_PORT               # 3000
```

---

## Troubleshooting

### Agent Not Responding

1. Check logs: `tail -f logs/openagora.log`
2. Verify API keys in `.env`
3. Check channel connectivity: `openagora health`
4. Review agent registry: `openagora agents list`

### High Latency

1. Check model API status
2. Review active task queue: `openagora queue status`
3. Monitor resource usage: `docker stats openagora`
4. Check network connectivity

### Channel Connection Issues

**Slack**: Verify bot is in the workspace and has permissions
**Discord**: Check bot permissions and intents are enabled
**Telegram**: Ensure webhook URL is publicly accessible
**Webhook**: Verify secret header is correct

---

## Advanced Features

### Ralph Loop (Autonomous Recovery)

Automatically detects and recovers from stagnation:

```yaml
# config/health.yaml
ralph:
  enabled: true
  stagnation_threshold: 3      # iterations without improvement
  timeout: 600                  # 10 minutes per agent
  auto_recovery: true
```

### Multi-Model Verification

Tasks are verified across models for confidence:

1. Primary: Claude implements
2. Review: Codex reviews code quality
3. Verification: Gemini validates correctness

### Dynamic Agent Creation

Builder Agent automatically creates specialized agents:

```
User: "Audit smart contracts"
→ No blockchain expert available
→ Builder Agent creates expert-blockchain-auditor
→ Task routed to new expert
```

### Worktree Isolation

Each agent gets an isolated git worktree:

```
~/project/
├── openagora/                 # main repo
└── .claude/worktrees/
    ├── agent-backend-dev-xyz/
    ├── agent-frontend-dev-abc/
    └── agent-tester-xyz/
```

---

## Contributing

1. Follow the coding standards in `CLAUDE.md`
2. Write tests for new features
3. Submit PR with description
4. Ensure CI passes

---

## Performance Tuning

### Parallel Task Execution

```bash
# Increase parallel agents (default: 5)
openagora config set max_parallel_agents 10
```

### Token Budget

```bash
# Set max tokens per task (default: 50000)
openagora config set max_tokens_per_task 100000
```

### Circuit Breaker

```bash
# Configure failure threshold (default: 5)
openagora config set circuit_breaker_threshold 10
```

---

## API Reference

### REST API

```bash
# Get project status
GET /api/projects/:name

# List all projects
GET /api/projects

# Create task
POST /api/projects/:name/tasks
{
  "task": "implement feature",
  "priority": "high",
  "channel": "cli"
}

# Get task status
GET /api/tasks/:id

# List agents
GET /api/agents

# Get model capabilities
GET /api/models
```

---

## License

See LICENSE file for details.

---

## Support

- Issues: GitHub Issues
- Documentation: `/docs`
- Community: GitHub Discussions

---

**Version:** 1.0.0
**Last Updated:** March 2026
**Maintainer:** hackit
