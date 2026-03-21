# OpenAgora Architecture Documentation

Complete architectural documentation for the OpenAgora multi-agent orchestration platform.

## File Guide

### 1. **overview.md** (255 lines, 16 KB)
High-level system architecture and design decisions.

**Contents**:
- System summary and problem statements (P1-P8)
- Design patterns (queue-per-project, domain routing, multi-stage validation, etc.)
- System boundaries (in/out of scope)
- Architecture Decision Records (6 ADRs)
- System architecture diagram
- Component responsibility matrix

**Read this first** to understand what OpenAgora does and why it was designed this way.

---

### 2. **modules.md** (447 lines, 16 KB)
Module structure and responsibilities.

**Contents**:
- Directory layout with descriptions
- 9 modules with detailed responsibilities:
  - adapters/ (6 channel adapters)
  - agents/ (execution, registry, builder, P2P)
  - config/ (configuration loading)
  - health/ (monitoring and recovery)
  - models/ (orchestration and routing)
  - queue/ (task queueing)
  - router/ (project dispatch)
  - types/ (type definitions)
  - utils/ (logging)
- Public interfaces for each module
- Dependency flow diagram
- Internal vs external dependency analysis

**Read this** to understand module responsibilities and interfaces.

---

### 3. **dependencies.md** (299 lines, 12 KB)
Dependency graph and package analysis.

**Contents**:
- Internal module dependency graph (ASCII diagram)
- External packages organized by category:
  - Communication channels (7 packages: Slack, Discord, Telegram, Email, Webhook)
  - Task management (1 package: p-queue)
  - Version control (1 package: simple-git)
  - Config/validation (3 packages: yaml, zod, dotenv)
  - Logging (1 package: winston)
  - Type definitions (2 packages)
- Circular dependency analysis (none found)
- Dependency risk assessment
- Upgrade recommendations
- Transitive dependency concerns

**Read this** to understand dependencies and risk management.

---

### 4. **entry-points.md** (478 lines, 12 KB)
Application startup sequence and entry points.

**Contents**:
- 9-stage application startup sequence (process bootstrap → shutdown handlers)
- Configuration loading
- Component initialization order (health first, router second)
- Adapter activation
- Health daemon startup
- Message processing entry points:
  - Channel adapter ingestion
  - ProjectRouter.handleMessage() flow
  - Agent execution pipeline
  - Health monitoring loop
  - Health HTTP endpoint (/health)
  - Task discovery callback
- CLI adapter usage
- Signal handlers (SIGTERM, SIGINT)
- Startup checklist

**Read this** to understand how the system starts and what triggers execution.

---

### 5. **data-flow.md** (449 lines, 24 KB)
Data flow paths and request lifecycle.

**Contents**:
- Overall message lifecycle (channel → router → queue → executor → orchestrator → response)
- Request processing state machine
- Queue and concurrency model (per-project FIFO, parallel across projects)
- Worktree isolation (task-level git isolation for safe parallelism)
- Health monitoring data flow (every 10 minutes)
- P2P agent delegation (DELEGATE blocks in output)
- Circuit breaker state machine (closed → open → half-open recovery)
- RalphLoop convergence detection (stagnation detection, max iterations)
- State persistence (in-memory vs disk)

**Read this** to understand how data flows through the system and task execution lifecycle.

---

## Quick Navigation

### By Role

**System Architect**: overview.md → modules.md → dependencies.md

**Backend Developer**: modules.md → entry-points.md → data-flow.md

**DevOps/Infrastructure**: dependencies.md → entry-points.md (startup checklist)

**Debugging/Troubleshooting**: data-flow.md → entry-points.md → modules.md

---

### By Topic

| Topic | Files |
|-------|-------|
| System design patterns | overview.md |
| Component responsibilities | modules.md |
| Concurrency model | data-flow.md |
| Agent execution flow | entry-points.md, data-flow.md |
| Health monitoring | entry-points.md, data-flow.md |
| Multi-stage validation | overview.md, data-flow.md |
| Dependency management | dependencies.md |
| Startup sequence | entry-points.md |
| Package risk assessment | dependencies.md |

---

## Key Architectural Concepts

### 1. Queue-per-Project Pattern
Each project maintains a FIFO queue with concurrency=1. Prevents channel collision (P1) while allowing parallel execution across projects.

**Learn more**: overview.md § System Design Patterns, data-flow.md § Queue Data Structure

### 2. Domain-Driven Agent Routing
Tasks classified by content (regex patterns) and routed to specialized agents. BuilderAgent creates new agents on-demand (P5).

**Learn more**: overview.md § System Design Patterns, modules.md § agents/

### 3. Multi-Stage Validation Pipeline
Primary (Claude) → Review (Codex) → Verify (Gemini). All stages best-effort; only primary blocks. RalphLoop detects convergence.

**Learn more**: overview.md § ADR-003, data-flow.md § Multi-Stage Execution Pipeline

### 4. Worktree Isolation per Task
Each task executes in a separate git worktree (P4). Safe parallelism; no file conflicts.

**Learn more**: overview.md § ADR-002, data-flow.md § Worktree Isolation Data Flow

### 5. Circuit Breaker for Fault Isolation
Agents failing 5+ times are deprioritized. System resilience without manual intervention.

**Learn more**: overview.md § ADR-006, data-flow.md § Circuit Breaker State Machine

### 6. RalphLoop Convergence Detection
Retry loop with stagnation detection (P6). Prevents infinite retries; allows useful feedback iterations.

**Learn more**: overview.md § ADR-004, data-flow.md § RalphLoop Convergence Detection

---

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

---

## File Dependencies

```
overview.md (foundation)
  ↓
modules.md (structure)
  ├─→ dependencies.md (packages and risks)
  └─→ entry-points.md (initialization)
      └─→ data-flow.md (execution)
```

**Suggested reading order**: overview → modules → dependencies → entry-points → data-flow

---

## Statistics

| File | Lines | Size | Sections | Content Type |
|------|-------|------|----------|--------------|
| overview.md | 255 | 16 KB | 6 | Architecture patterns, ADRs |
| modules.md | 447 | 16 KB | 4 | Module structure, interfaces |
| dependencies.md | 299 | 12 KB | 10 | Package graph, risk analysis |
| entry-points.md | 478 | 12 KB | 6 | Startup sequence, signals |
| data-flow.md | 449 | 24 KB | 11 | Execution lifecycle, state |
| **Total** | **1,928** | **80 KB** | **37** | **Complete architecture** |

---

## Verification Checklist

All documentation has been verified against source code:

- [x] All code examples tested and traced to source files
- [x] Module descriptions match actual implementation
- [x] Dependency list matches package.json and imports
- [x] Startup sequence traced from src/index.ts
- [x] Data flow diagrams match actual execution paths
- [x] ADRs document actual design decisions
- [x] All files use clean Markdown with ASCII diagrams
- [x] No broken internal references
- [x] Consistent terminology throughout
- [x] English language, clear and scannable

---

## How to Use This Documentation

### For New Team Members
1. Start with **overview.md** (10 min read) — understand system goals
2. Read **modules.md** (15 min read) — understand components
3. Skim **entry-points.md** (10 min read) — understand startup
4. Explore **data-flow.md** (15 min read) — understand execution

**Total time: ~50 minutes** to understand system architecture.

### For Debugging
1. Identify which component has the issue
2. Read the relevant section in **modules.md**
3. Trace the data flow in **data-flow.md**
4. Check startup sequence in **entry-points.md** if initialization-related

### For Adding Features
1. Understand the component responsible (modules.md)
2. Check the module's public interface (modules.md)
3. Trace how data flows through it (data-flow.md)
4. Verify dependency implications (dependencies.md)

### For Performance Optimization
1. Identify bottleneck (health monitoring data flow in data-flow.md)
2. Check queue model (data-flow.md § Queue Data Structure)
3. Review concurrency limits (overview.md § Queue-per-Project Pattern)
4. Check timeout settings (entry-points.md § Agent Execution Pipeline)

---

## Contact & Updates

**Version**: 0.1.0
**Last Updated**: 2026-03-21
**Status**: Active Development

For updates or corrections, ensure consistency across all 5 files when making changes.

---

