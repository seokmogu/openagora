# OpenAgora Architecture Overview

## High-Level System Summary

OpenAgora is a multi-agent orchestration platform that receives tasks from multiple channels (Slack, Discord, Telegram, Email, Webhook, CLI), routes them through domain-aware expert agents, and executes them with multi-stage validation and quality gates.

The system solves eight critical problems:
- **P1**: Multi-channel concurrent request collisions → Project-specific FIFO queues
- **P2**: Zombie heartbeat processes → ProcessWatcher + SIGKILL on timeout
- **P3**: Work continuation across heartbeat intervals → Circuit breaker + state tracking
- **P4**: Parallel project code conflicts → Git worktrees per task
- **P5**: Fixed agent architecture → Dynamic agent generation via BuilderAgent
- **P6**: Unstable 24-hour autonomous operation → Ralph loop + convergence detection
- **P7**: Single-model dependency → Multi-model router (Claude, Codex, Gemini)
- **P8**: Missing external tool integration → Capability-based routing system

## System Design Patterns

### 1. Queue-per-Project Pattern
Each project maintains its own FIFO queue with concurrency=1 (P1 solution). This ensures:
- No channel collision (Slack and Discord requests don't interfere)
- Strict ordering within a project
- Clear visibility into pending work

### 2. Domain-Driven Agent Routing
Tasks are classified by domain and routed to specialized agents:
- `planning` → expert-planner
- `development` → expert-developer
- `database` → expert-dba
- `analysis` → expert-analyst
- `research` → expert-researcher
- `writing` → expert-writer
- `general` → expert-developer (fallback)

New domains trigger BuilderAgent to create custom experts on-the-fly (P5 solution).

### 3. Multi-Stage Execution Pipeline
```
Primary (Claude) → Review (Codex) → Verify (Gemini) → Convergence Check
```

All three stages are best-effort with timeouts. Only primary blocks; review and verify are for quality improvement. RalphLoop detects convergence and prevents infinite retries.

### 4. Capability-Based Model Routing
Domains map to capabilities, which map to multi-model routes:
- `best-coding` → Claude for implementation
- `best-analysis` → Gemini for long-context analysis
- `best-research` → Perplexity for web search
- `best-writing` → Claude Opus for academic work
- `best-ui` → v0 (Vercel) for UI design
- `best-image` → DALL-E 3, Midjourney, or Flux

### 5. Health-Driven Autonomous Loop
HealthDaemon runs checks every 10 minutes:
- ProcessWatcher detects zombie processes and kills them (P2 solution)
- TaskDiscovery finds incomplete work and re-enqueues it (P3 solution)
- Circuit breakers open after 5 consecutive failures
- TeammateIdle gate prevents work from marking complete until LSP passes

### 6. Isolated Execution via Worktrees
Each task creates a separate git worktree for isolated code changes (P4 solution):
- No file conflicts between parallel tasks
- Clean rollback on failure (worktree deletion)
- Concurrent project work safe

## System Boundaries

### In Scope
- Multi-channel message ingestion (6 adapters)
- Project and task lifecycle management
- Domain detection and agent routing
- Multi-stage execution orchestration
- Health monitoring and autonomous recovery
- Dynamic agent generation
- Multi-model evaluation

### Out of Scope
- LLM fine-tuning or model training
- Direct cloud infrastructure provisioning (only git-based)
- Real-time communication (async only)
- Complex workflow definitions (simple routing logic)
- Persistent task history (state lives in process memory)

## Architecture Decision Records (ADRs)

### ADR-001: Project-Scoped Queues (P1)
**Decision**: Use one queue per project with concurrency=1.

**Rationale**: Prevents channel collision while maintaining simplicity. Slack and Discord can send concurrent requests; they're queued separately per project.

**Alternatives Rejected**:
- Global queue with locking: Too coarse-grained
- Per-channel queue: Allows channel cross-talk
- Async fire-and-forget: No guarantee of order or completion

---

### ADR-002: Worktree Isolation (P4)
**Decision**: Create a separate git worktree for each task execution.

**Rationale**: Guarantees file-system isolation between parallel tasks on the same project. Prevents git conflicts and race conditions.

**Alternatives Rejected**:
- Copy entire repo per task: Too slow
- Shared checkout with file locking: Deadlock risk
- In-memory virtual filesystem: Complex and fragile

---

### ADR-003: Multi-Stage Validation (P7)
**Decision**: Primary (Claude) → Review (Codex) → Verify (Gemini), all best-effort.

**Rationale**: Reduces model dependency. Claude handles coding; Codex reviews for style/security; Gemini verifies logic independently. All stages have timeouts; only primary blocks.

**Alternatives Rejected**:
- Single model only: No diversity, single point of failure
- Sequential required stages: Too slow
- All stages blocking: Cascading timeouts

---

### ADR-004: RalphLoop for Convergence (P6)
**Decision**: Use RalphLoop to detect stagnation and force convergence after max iterations.

**Rationale**: Prevents infinite retry loops in 24-hour autonomous mode. Stagnation detection compares verify output; identical feedback triggers automatic exit.

**Alternatives Rejected**:
- Fixed max iterations: Misses useful feedback
- Simple timeout: Wastes time on low-risk retries
- No retry mechanism: Loses correction opportunities

---

### ADR-005: Dynamic Agent Generation (P5)
**Decision**: BuilderAgent creates new specialist agents on-demand via `.claude/agents/moai/`.

**Rationale**: System learns and evolves. New domains don't require code changes; they trigger agent generation.

**Alternatives Rejected**:
- Hardcoded agent list: No flexibility
- Prompt-injection approach: No persistence
- Manual agent registry updates: Too slow

---

### ADR-006: Circuit Breaker for Fault Isolation
**Decision**: Open circuit after 5 consecutive failures; half-open after 1 success.

**Rationale**: Prevents cascading failures. Failing agents are automatically deprioritized.

**Alternatives Rejected**:
- Exponential backoff: No hard cutoff
- Manual intervention: Not autonomous
- No fault isolation: Cascading failures

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CHANNEL ADAPTERS (External)                         │
│  ┌──────────┐ ┌─────────┐ ┌────────────┐ ┌──────┐ ┌──────────┐ ┌─────┐ │
│  │  Slack   │ │ Discord │ │ Telegram   │ │Email │ │Webhook   │ │ CLI │ │
│  └────┬─────┘ └────┬────┘ └────┬───────┘ └──┬───┘ └────┬─────┘ └─┬───┘ │
└───────┼──────────────┼──────────┼────────────┼──────────┼──────────┼─────┘
        │ Normalized   │          │            │          │          │
        │ ChannelMessage           │            │          │          │
        └──────────────┴──────────┴────────────┴──────────┴──────────┘
                               │
                      ┌────────▼────────┐
                      │  PROJECT ROUTER │
                      │                 │
                      │ • Registry      │
                      │ • Domain detect │
                      │ • Project match │
                      │ • Job creation  │
                      └────────┬────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │ Queue (Project-Scoped, Concurrency=1)       │
        │ ┌────┐ ┌────┐ ┌────┐                       │
        │ │Job1│ │Job2│ │Job3│  (FIFO per project)  │
        │ └──┬─┘ └────┘ └────┘                       │
        └────┼──────────────────────────────────────┘
             │
    ┌────────▼───────────┐
    │ AGENT EXECUTOR     │
    │ • Spawn claude CLI │
    │ • Set agent flag   │
    │ • Create worktree  │
    │ • Run 30min timeout│
    │ • Capture output   │
    └────────┬───────────┘
             │
    ┌────────▼──────────────────────────┐
    │ MULTI-STAGE ORCHESTRATOR          │
    │                                    │
    │ PRIMARY (Claude)                   │
    │ ├─ Execution result                │
    │ └─ P2P routing if needed           │
    │                                    │
    │ REVIEW (Codex, best-effort)        │
    │ ├─ Timeout: 5 min                  │
    │ └─ Status: ok|timeout|error        │
    │                                    │
    │ VERIFY (Gemini, best-effort)       │
    │ ├─ Timeout: 5 min                  │
    │ ├─ RalphLoop retry logic           │
    │ └─ Convergence check               │
    │                                    │
    │ RESULT                             │
    │ └─ Summary + all stages            │
    └────────┬──────────────────────────┘
             │
    ┌────────▼──────────────────┐
    │ HEALTH DAEMON             │
    │ (Every 10 minutes)        │
    │                            │
    │ • ProcessWatcher          │
    │   → SIGKILL on timeout    │
    │                            │
    │ • TaskDiscovery           │
    │   → Detect incomplete     │
    │   → Re-enqueue            │
    │                            │
    │ • CircuitBreakers         │
    │   → Open after 5 failures │
    │   → Half-open recovery    │
    │                            │
    │ • Health HTTP endpoint    │
    │   → /health (JSON)        │
    └───────────────────────────┘
```

## Key Components Summary

| Component | Responsibility | Key Files |
|-----------|-----------------|-----------|
| **Adapters** | Ingest from 6 channels, normalize to ChannelMessage | `src/adapters/*.ts` |
| **ProjectRouter** | Central dispatch: match project, detect domain, enqueue | `src/router/project-router.ts` |
| **ProjectQueue** | Per-project FIFO with concurrency=1 | `src/queue/project-queue.ts` |
| **AgentExecutor** | Spawn claude CLI, worktree isolation, timeout handling | `src/agents/executor.ts` |
| **AgentRegistry** | Maintain builtin + dynamic agents, domain→agent mapping | `src/agents/registry.ts` |
| **MultiStageOrchestrator** | Pipeline: primary → review → verify → convergence | `src/models/multi-stage.ts` |
| **HealthDaemon** | Monitor processes, discover tasks, run HTTP endpoint | `src/health/daemon.ts` |
| **ModelRouter** | Map capabilities to model routes (Claude/Codex/Gemini) | `src/models/router.ts` |
| **ProcessWatcher** | Track spawned processes, kill zombies | `src/health/process-watcher.ts` |
| **RalphLoop** | Convergence detection and retry logic | `src/health/ralph-loop.ts` |

---

**Version**: 0.1.0
**Last Updated**: 2026-03-21
**Status**: Active Development
