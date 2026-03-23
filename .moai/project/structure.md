# Project Structure

## Directory Organization

```
openagora/
├── src/                               # TypeScript source code (8,380 lines)
│   ├── adapters/                      # Channel adapters (6 channels + manager)
│   │   ├── base.ts                    # Abstract adapter interface
│   │   ├── slack.ts                   # Slack Socket Mode integration
│   │   ├── discord.ts                 # Discord.js bot adapter
│   │   ├── telegram.ts                # Telegraf bot adapter
│   │   ├── email.ts                   # IMAP/SMTP email integration
│   │   ├── webhook.ts                 # Express HTTP webhook receiver
│   │   ├── cli.ts                     # Interactive CLI adapter
│   │   ├── manager.ts                 # Coordinate all adapters
│   │   └── __tests__/                 # Adapter tests (6 files)
│   │
│   ├── agents/                        # Agent implementations
│   │   ├── executor.ts                # Execute tasks, manage agent lifecycle
│   │   ├── registry.ts                # Register/lookup agents and their capabilities
│   │   ├── builder-agent.ts           # Dynamically create specialized agents
│   │   ├── p2p-router.ts              # Direct agent-to-agent messaging
│   │   └── __tests__/                 # Agent tests (3 files)
│   │
│   ├── models/                        # Multi-model router and orchestration
│   │   ├── router.ts                  # Select best model per task type
│   │   ├── multi-stage.ts             # 3-stage pipeline: Claude→Review→Verify
│   │   └── __tests__/                 # Model tests (2 files)
│   │
│   ├── router/                        # Central dispatch hub
│   │   ├── project-router.ts          # Route tasks to projects, manage lifecycle
│   │   ├── project-creator.ts         # Spawn new projects with git init
│   │   ├── registry.ts                # Load/save project registry
│   │   ├── command-parser.ts          # Parse channel messages to tasks
│   │   └── __tests__/                 # Router tests (3 files)
│   │
│   ├── queue/                         # Task management
│   │   ├── project-queue.ts           # Per-project FIFO task queue
│   │   └── __tests__/                 # Queue tests (1 file)
│   │
│   ├── health/                        # Health monitoring (8 submodules)
│   │   ├── daemon.ts                  # Main health daemon coordinator
│   │   ├── ralph-loop.ts              # Detect stagnation (>N iterations no improvement)
│   │   ├── circuit-breaker.ts         # Auto-shutdown after 5 failures
│   │   ├── health-monitor.ts          # Periodic health checks
│   │   ├── process-watcher.ts         # Monitor agent processes
│   │   ├── worktree.ts                # Git worktree isolation manager
│   │   ├── notifier.ts                # Send alerts/status updates
│   │   ├── task-discovery.ts          # Resume tasks on restart
│   │   └── __tests__/                 # Health tests (8 files)
│   │
│   ├── config/                        # Configuration loading
│   │   ├── loader.ts                  # Load all config files
│   │   └── __tests__/                 # Config tests (1 file)
│   │
│   ├── types/                         # Type definitions
│   │   └── index.ts                   # Zod schemas for validation
│   │
│   ├── cli/                           # Command-line interface
│   │   ├── main.ts                    # CLI entry point and commands
│   │   ├── setup.ts                   # Configuration wizard
│   │   ├── env-manager.ts             # .env file helper
│   │   └── tokens.ts                  # API token validation
│   │
│   ├── utils/                         # Utilities
│   │   └── logger.ts                  # Winston logging configuration
│   │
│   ├── index.ts                       # Main entry point (app startup)
│   └── __tests__/                     # Shared fixtures
│       └── fixtures.ts
│
├── config/                            # Configuration files
│   ├── channels.yaml                  # Channel activation and credentials
│   ├── models.yaml                    # Model assignments and capabilities
│   └── mcp.json                       # MCP server configurations
│
├── registry/                          # Runtime registry (persisted)
│   ├── projects.json                  # Active projects and paths
│   └── agents.json                    # Registered agents and specs
│
├── .moai/project/                     # MoAI project documentation
│   ├── product.md                     # Product overview and use cases
│   ├── structure.md                   # This file
│   └── tech.md                        # Technology stack
│
├── .claude/                           # Claude Code integration
│   ├── agents/                        # Agent definitions
│   ├── rules/                         # Development rules
│   ├── skills/                        # Custom skills
│   └── hooks/                         # Lifecycle hooks
│
├── bin/                               # Executable scripts
│   └── openagora.js                   # CLI entry point
│
├── dist/                              # Compiled TypeScript output
│
├── package.json                       # Dependencies and scripts
├── tsconfig.json                      # TypeScript configuration
├── vitest.config.ts                   # Test runner configuration
├── .env.example                       # Environment template
├── .gitignore                         # Git exclusions
├── README.md                          # User documentation
├── CLAUDE.md                          # MoAI execution directive
├── SPEC.md                            # Feature specifications
└── openagora.service                  # Systemd service definition

```

## Component Purposes

### Adapters (`src/adapters/`)
Normalize incoming messages from different channels into unified Task objects. Each adapter implements:
- Message receiving (async polling or webhooks)
- Message parsing (extract task, priority, metadata)
- Message sending (format responses back to channel)
- Connection lifecycle management

**Flow:** Channel → Adapter → ProjectRouter → Queue

### Agents (`src/agents/`)
Execute tasks autonomously and manage agent lifecycle:
- **Executor**: Spawn and monitor agent subprocesses
- **Registry**: Track available agents and their roles
- **Builder**: Create new specialized agents on-demand
- **P2P Router**: Enable direct agent-to-agent communication

### Models (`src/models/`)
Select and orchestrate AI models for different task types:
- **Router**: Match task characteristics to optimal model (coding→Claude, research→Perplexity)
- **MultiStage**: Implement 3-stage verification pipeline (Claude implements → Codex reviews → Gemini verifies)

### Router (`src/router/`)
Central dispatch hub coordinating all components:
- **ProjectRouter**: Accept tasks, look up projects, queue execution
- **ProjectCreator**: Initialize new projects with git repository
- **Registry**: Persist project and agent metadata to disk
- **CommandParser**: Transform channel commands into structured tasks

### Queue (`src/queue/`)
Manage per-project task execution order:
- Per-project FIFO ensures sequential, isolated execution
- Prevents concurrent modification conflicts
- Supports task priority and retry logic

### Health (`src/health/`)
Monitor system stability and prevent degradation:
- **Daemon**: Orchestrate all health subsystems
- **RalphLoop**: Detect iteration stagnation (no improvement N iterations)
- **CircuitBreaker**: Auto-shutdown after 5 consecutive failures
- **HealthMonitor**: Periodic checks (CPU, memory, queue depth)
- **ProcessWatcher**: Track subprocess lifecycle and resource usage
- **Worktree**: Manage isolated git workspaces per agent
- **Notifier**: Send alerts and status updates
- **TaskDiscovery**: Resume incomplete tasks after restart

### Config (`src/config/`)
Load and validate configuration:
- channels.yaml → which adapters to activate
- models.yaml → model assignments per task type
- mcp.json → MCP server endpoints
- Environment variables → API keys and system settings

### CLI (`src/cli/`)
Provide command-line interface for operators:
- `openagora setup` – Interactive configuration wizard
- `openagora run <project> <task>` – Execute task directly
- `openagora projects list` – Show active projects
- Token validation and .env management

### Types (`src/types/`)
Zod schemas for runtime validation:
- Task, Agent, Project, Config types with validation
- Ensures type safety at system boundaries

### Utils (`src/utils/`)
Shared utilities:
- Winston logger with structured logging
- JSON and error formatting

## Test Organization

**25 test files, 232+ tests covering:**
- Core executors and orchestrators
- All 6 adapters + manager
- Agent registry and P2P routing
- Health subsystems (8 test files)
- Model router and multi-stage pipeline
- Config loading and validation

Test conventions:
- `*.test.ts` or `*.spec.ts` file naming
- Vitest for fast execution
- Fixtures for shared test data
- 85%+ target coverage per module
