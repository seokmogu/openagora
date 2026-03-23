# Product Overview

## Project Name
OpenAgora

## Description
OpenAgora is an open-source multi-agent orchestration platform that coordinates specialized AI agents across multiple models and communication channels. It solves complex tasks autonomously by integrating state-of-the-art language models (Claude, Gemini, Perplexity, etc.) with real-time communication infrastructure (Slack, Discord, Telegram) and external tools (GitHub, Notion, web search).

## Target Audience
- Development teams needing autonomous code generation and review
- Organizations seeking 24/7 intelligent task automation
- Researchers and analysts requiring multi-agent coordination
- Academic institutions using AI for research and writing
- Enterprises integrating multiple AI models in unified workflow

## Core Features

### Multi-Channel Communication
- **Slack** – Direct agent invocation with Socket Mode
- **Discord** – Server-based agent commands
- **Telegram** – Bot-based async messaging
- **Email** – IMAP/SMTP integration for document processing
- **Webhook** – Custom HTTP endpoint for programmatic triggering
- **CLI** – Local command-line interface

### Intelligent Agent Routing
- Central project router with git-backed project isolation
- Manager agents: project, spec, strategy, git, docs, quality
- Expert agents: backend, frontend, security, devops, testing (dynamically created)
- Builder agents: auto-generate specialized agents on-demand
- P2P agent communication with git worktree isolation

### Multi-Model Execution
- **Code Implementation** – Claude Sonnet/Opus
- **Code Review** – Codex/GPT-4 (via CLI integration)
- **Verification** – Gemini API
- **Research** – Perplexity API
- **Writing** – Claude Opus
- **Image Generation** – DALL-E 3, Midjourney, Flux
- **UI Design** – Vercel v0

### Task Management & Health Monitoring
- Per-project FIFO task queue
- Ralph Loop – Autonomous stagnation detection
- Circuit Breaker – Auto-shutdown after 5 consecutive failures
- Health Daemon – Process monitoring with graceful termination
- Worktree Manager – Isolated execution contexts per agent
- Multi-stage orchestration: Claude → Review → Verify

### Advanced Orchestration
- Dynamic agent creation via Builder Agent
- Git worktree isolation per agent task
- Graceful termination with max-runs, max-cost, max-duration limits
- LSP quality gates (zero errors, coverage thresholds)
- MCP server integrations (Notion, GitHub, Sequential Thinking, Memory, Exa, Firecrawl)

## Problems Solved

### P1: Concurrent Request Conflicts
Multiple simultaneous requests from different channels would collide and corrupt task state. Solution: Per-project FIFO queue isolates requests into sequential, independent execution streams.

### P2: Zombie Processes
Long-running agents would hang indefinitely when stuck. Solution: Circuit Breaker (5 failures triggers auto-shutdown) + Ralph Loop (detects improvement stagnation) + 30-second SIGKILL timeout.

### P3: Task Persistence
Agent progress disappeared on restart. Solution: Registry-backed project storage with git-based persistence for all task artifacts and agent state.

### P4: Parallel Code Conflicts
Multiple agents modifying the same repository caused merge conflicts. Solution: Git worktree isolation—each agent gets isolated git workspace preventing cross-agent interference.

### P5: Fixed Agent Structure
No way to add specialized agents for new domains (e.g., blockchain auditor). Solution: Builder Agent dynamically creates and registers new expert agents matching any task requirement.

### P6: 24/7 Instability
System reliability degraded under sustained load. Solution: Health Daemon + Process Watcher + Graceful Termination ensures stable operation; metrics/healthcheck endpoints provide observability.

### P7: Single-Model Dependency
Entire system failed if one model (Claude) became unavailable. Solution: Multi-stage verification across Gemini, Perplexity, and others; task router auto-switches models based on availability and capability matching.

### P8: No Tool Integration
Agents worked in isolation without external tool access. Solution: MCP server architecture integrates Notion (docs), GitHub (repos), Sequential Thinking (analysis), Memory (knowledge), Exa (search), Firecrawl (scraping), Playwright (automation), Context7 (API docs).

## Use Cases

### Software Development
- Autonomous code implementation from specifications
- Multi-stage code review and verification
- Test suite generation and coverage tracking
- Codebase refactoring and optimization
- Security audit and vulnerability scanning

### Research & Analysis
- Multi-model fact-checking and synthesis
- Academic paper research and writing
- Data analysis and visualization
- Competitive intelligence gathering
- Document summarization and extraction

### Content Creation
- Long-form essay and article generation
- Documentation writing from code
- Technical blog post creation
- API documentation generation

### 24/7 Operations
- Continuous monitoring and alerting
- Automated incident response
- On-call escalation and triage
- Scheduled task automation
