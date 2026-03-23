# OpenAgora Architecture Codemaps

This directory contains comprehensive architecture documentation for the OpenAgora multi-agent orchestration platform.

## Documents Overview

### 1. **overview.md** (278 lines)
High-level architecture, design patterns, system layers, and key invariants.

**Read this first to understand:**
- Event-driven architecture pattern
- Plugin-based adapter system
- Circuit breaker fault tolerance
- System layer responsibilities
- Integration points

**Key sections:**
- Core Design Patterns (4 patterns explained)
- System Layers (6 layers: adapters → health monitoring)
- Key Invariants (6 core guarantees)
- Error Handling Strategy

### 2. **modules.md** (499 lines)
Detailed reference for all modules, public interfaces, and dependencies.

**Read this to:**
- Understand each module's responsibility
- Find public APIs and type definitions
- Navigate module dependencies
- See testing patterns
- Locate export patterns

**Key sections:**
- Module Directory Structure
- Core Modules (10 modules detailed)
- Module Dependency Graph
- Circular Dependency Analysis

### 3. **dependencies.md** (299 lines)
All runtime and development dependencies, with versions, purposes, and vulnerability management.

**Read this to:**
- Understand what packages are used
- See dependency relationships
- Check installation commands
- Manage security updates
- Understand size impact

**Key sections:**
- Runtime Dependencies (13 packages)
- Development Dependencies (8 packages)
- Internal Module Dependency Graph
- Security Considerations

### 4. **entry-points.md** (476 lines)
Startup flows, CLI commands, HTTP endpoints, and graceful shutdown.

**Read this to:**
- Start the application correctly
- Use CLI subcommands
- Monitor health endpoint
- Handle errors at entry points
- Debug startup issues

**Key sections:**
- Primary Entry Points (main + CLI)
- Secondary Entry Points (webhook + health)
- Configuration Loading Flow
- Graceful Shutdown Flow
- Performance Characteristics

### 5. **data-flow.md** (638 lines)
Complete request lifecycle from user input to agent response, with error propagation and special cases.

**Read this to:**
- Trace a message through the system
- Understand error handling at each phase
- Debug health monitoring
- See data structures in motion
- Learn special case handling

**Key sections:**
- Core Message Lifecycle (7 phases)
- Error Propagation (per phase)
- Health Check Flow (10-minute interval)
- Data Structures in Motion
- Performance Characteristics

## Quick Navigation

### By Use Case

**I need to add a new channel adapter:**
1. Read: overview.md → "Plugin Architecture"
2. Read: modules.md → "adapters/" section
3. Reference: entry-points.md → "Primary Entry Points" for lifecycle

**I'm debugging a stuck task:**
1. Read: data-flow.md → "Error Propagation" section
2. Check: entry-points.md → "Error Handling at Entry Points"
3. Review: modules.md → "health/" section

**I need to understand agent execution:**
1. Read: overview.md → "System Layers" section
2. Read: data-flow.md → "PHASE 4" and "PHASE 5"
3. Reference: modules.md → "agents/" section

**I'm setting up monitoring:**
1. Read: entry-points.md → "Health Endpoint"
2. Read: data-flow.md → "Health Check Flow"
3. Reference: dependencies.md → "External API Versions"

**I need to scale the system:**
1. Read: overview.md → "Key Invariants"
2. Read: data-flow.md → "Performance Characteristics"
3. Review: modules.md → "Module Dependency Graph"

### By Component

**Adapters (Slack, Discord, etc.):**
- overview.md → "Plugin Architecture"
- modules.md → "adapters/"
- entry-points.md → "Primary Entry Points"
- data-flow.md → "PHASE 1"

**Routing & Project Management:**
- modules.md → "router/"
- data-flow.md → "PHASE 2"
- entry-points.md → "Configuration Loading Flow"

**Task Queue:**
- modules.md → "queue/"
- data-flow.md → "PHASE 3"

**Agent Execution:**
- modules.md → "agents/"
- data-flow.md → "PHASE 4"
- entry-points.md → "Agent Execution Flow"

**Multi-Stage Orchestration:**
- overview.md → "Strategy Pattern"
- modules.md → "models/"
- data-flow.md → "PHASE 5"

**Health Monitoring:**
- modules.md → "health/"
- data-flow.md → "Health Check Flow"
- entry-points.md → "Health Endpoint"

**CLI & Configuration:**
- modules.md → "cli/" and "config/"
- entry-points.md → "CLI Interface"

## File Statistics

| Document | Lines | Topics | Tables |
|----------|-------|--------|--------|
| overview.md | 278 | 8 | 3 |
| modules.md | 499 | 11 | 8 |
| dependencies.md | 299 | 8 | 3 |
| entry-points.md | 476 | 10 | 4 |
| data-flow.md | 638 | 12 | 2 |
| **Total** | **2,190** | **49** | **20** |

## Key Concepts

### Architectural Patterns

1. **Event-Driven**: Messages flow through normalized pipeline
2. **Plugin Architecture**: 6 adapters, conditional instantiation
3. **Strategy Pattern**: Domain-to-capability model routing
4. **Circuit Breaker**: Per-agent fault protection (5-failure threshold)
5. **FIFO Queue**: Per-project task buffering
6. **Multi-Stage Pipeline**: Primary → Review → Verify with Ralph Loop

### Layers (Bottom-up)

1. **Input Layer**: 6 channel adapters
2. **Routing Layer**: Project router, command parser
3. **Buffering Layer**: Per-project FIFO queues
4. **Execution Layer**: Agent executor, process watcher
5. **Orchestration Layer**: Multi-stage pipeline, model routing
6. **Health Layer**: Health daemon, circuit breaker, task discovery
7. **Integration Layer**: Main application, CLI, HTTP endpoints

### Key Invariants

1. Project Isolation: Tasks never cross projects
2. Process Containment: 30-minute timeout with SIGKILL
3. Circuit Breaker: Rapid failure rejection after 5 failures
4. Convergence Guarantee: Ralph Loop prevents infinite loops
5. Health Visibility: All failures discoverable
6. Message Atomicity: Exactly-once processing

## Development Workflow

### Understanding the Codebase

1. **Start**: Read overview.md (10 min)
2. **Deep dive**: Pick a component, read relevant sections (20 min)
3. **Reference**: modules.md for public APIs (5 min lookup)
4. **Debug**: Use data-flow.md to trace execution (15 min)
5. **Deploy**: Check entry-points.md for startup (5 min)

### Adding a Feature

1. Identify affected modules (modules.md dependency graph)
2. Understand current flow (data-flow.md)
3. Review error handling (data-flow.md error propagation)
4. Check dependencies (dependencies.md)
5. Plan entry point integration (entry-points.md)

### Debugging Issues

1. **Adapter issue**: Review adapters/ in modules.md, PHASE 1 in data-flow.md
2. **Queue stuck**: Check health daemon section, task discovery
3. **Agent timeout**: Review PHASE 4 in data-flow.md, process-watcher in modules.md
4. **Circuit breaker**: See circuit-breaker.ts reference in modules.md
5. **Multi-stage divergence**: Review Ralph Loop in data-flow.md

## Version Information

- **TypeScript**: 5.7+
- **Node.js**: 22 (ESM required)
- **Documentation**: English, as of 2026-03-23
- **Scope**: OpenAgora v0.1.0

## Related Documentation

- `.claude/agents/moai/` - Agent definitions
- `CLAUDE.md` - MoAI framework directives
- `package.json` - Build scripts and dependencies
- `.moai/config/sections/` - Configuration schema
