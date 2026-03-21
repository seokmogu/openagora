# OpenAgora Product Documentation

## Project Overview

**OpenAgora** is an open-source multi-agent orchestration platform that unifies communication across diverse channels and intelligently routes tasks to specialized agents. Built for Node.js with TypeScript, OpenAgora enables organizations to coordinate Claude-powered agents through Slack, Discord, Telegram, Email, Webhooks, and CLI interfaces.

## Description

OpenAgora bridges the gap between communication platforms and AI agent execution. Instead of managing separate integrations for each channel, teams deploy a single platform that normalizes user requests into a unified message format, routes them through a domain-aware agent registry, and executes them through a multi-stage model pipeline.

The platform emphasizes reliability and safety: per-project task queues prevent concurrent conflicts, worktree isolation ensures clean git operations, and circuit breakers protect against cascading failures. Health monitoring detects stagnation and zombie processes, automatically recovering from failures through the Ralph Loop self-healing mechanism.

OpenAgora is designed for teams and organizations that need flexible, multi-channel AI task execution with built-in reliability, observability, and scalability.

## Target Audience

- **Development Teams** — Seeking unified AI assistance across multiple communication channels
- **DevOps Teams** — Requiring reliable, self-healing task orchestration with health monitoring
- **Enterprise Deployments** — Needing domain-driven agent routing and audit trails
- **Open-Source Communities** — Building extensible, multi-platform AI workflows
- **Organizations** — Using Claude API for large-scale AI task distribution

## Core Features

- **Multi-Channel Integration** — Slack, Discord, Telegram, Email, Webhooks, and CLI adapters built-in
- **Domain-Driven Agent Routing** — Automatic task routing to specialized agents (planner, developer, DBA, analyst, researcher, writer, general)
- **Multi-Stage Model Execution** — Claude primary model → Codex review → Gemini verification pipeline
- **Health Monitoring & Circuit Breakers** — Automatic failure detection and recovery with configurable trip thresholds
- **Per-Project Task Queues** — FIFO queue with concurrency control prevents git conflicts and race conditions
- **Worktree Isolation** — Automatic git worktree creation per task eliminates concurrent modification errors
- **Process Watcher** — Detects and cleans up zombie processes from failed agent executions
- **Ralph Loop** — Autonomous stagnation detection and self-recovery mechanism
- **Dynamic Agent Generation** — BuilderAgent creates specialized agents on-demand for novel domains
- **P2P Agent Communication** — Direct agent-to-agent messaging layer for complex coordination
- **Structured Logging** — Winston-based logging with context preservation and error tracking

## Use Cases

### 1. Slack Bot Intelligence Assistant
Teams use OpenAgora as a Slack bot to ask Claude for code reviews, architecture advice, and documentation. The DeveloperAgent routes code-related questions and returns threaded responses with embedded code snippets.

### 2. CI/CD Integration & Webhook Automation
DevOps teams trigger AI-powered task execution via webhooks — automated code generation, dependency analysis, and deployment decision-making. Per-project queues ensure sequential, conflict-free execution across multiple microservices.

### 3. Multi-Channel Customer Support Orchestration
Support teams deploy OpenAgora across Slack, Discord, and Email to route customer questions to the most appropriate agent. AnalystAgent handles data questions, WriterAgent creates knowledge base articles, and GeneralAgent provides quick responses.

### 4. Domain Expert Agent Networks
Organizations create specialized agents (FinanceAgent, LegalAgent, SalesAgent) and OpenAgora intelligently routes incoming tasks to the right expert. P2P communication enables agents to collaborate on complex, cross-functional requests.

### 5. Autonomous Development Task Queue
Engineering teams submit work through CLI/Webhook interfaces. OpenAgora queues tasks, isolates them in git worktrees, executes them through multi-stage model verification, and reports results back through their preferred channel.

## Key Value Propositions

- **Unified Channel Experience** — Maintain a single platform for all communication channels instead of building separate integrations
- **Reliability at Scale** — Circuit breakers, health monitoring, and self-healing Ralph Loop ensure production stability
- **Safe Concurrent Execution** — Worktree isolation and per-project queues eliminate git conflicts and race conditions
- **Cost-Effective Verification** — Multi-stage pipeline routes expensive Opus reasoning only when needed, verifying with cheaper models
- **Observable & Auditable** — Structured logging and health endpoints provide visibility into all agent executions
- **Extensible Architecture** — Plugin-based adapter system and dynamic agent generation support custom domains
