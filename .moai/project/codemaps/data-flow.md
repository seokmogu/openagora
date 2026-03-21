# OpenAgora Data Flow

## Overall Message Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CHANNEL ADAPTER (External)                                               │
│ Slack / Discord / Telegram / Email / Webhook / CLI                      │
│ → Normalize to ChannelMessage                                            │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ ChannelMessage
                         │ { id, channel, userId, content, replyFn }
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ PROJECT ROUTER                                                            │
│ ├─ matchProject(content) → existing Project?                            │
│ │  └─ No? → creator.create() → new Project                             │
│ ├─ detectDomain(content) → DomainType                                   │
│ ├─ getAgentForDomain(domain) → agentId                                  │
│ └─ enqueue(projectId, message, executeJob)                              │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ Queued Task
                         │ { id, projectId, message, status: 'pending' }
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ PROJECT QUEUE (Per-Project FIFO, Concurrency=1)                         │
│                                                                          │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ Project A:  [Job1]  → Job2 → Job3                               │   │
│ │ Project B:               [Job4]  → Job5                          │   │
│ │ Project C:                            [Job6]                     │   │
│ │           (Currently executing)                                  │   │
│ └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│ When job done: dequeue next, or wait                                   │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ Execute Job Callback
                         │ await executeJob()
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ AGENT EXECUTOR                                                           │
│                                                                          │
│ 1. Check CircuitBreaker for agent                                       │
│ 2. Build prompt from task.message.content                               │
│ 3. Create git worktree (ProjectPath/worktrees/{taskId})                 │
│ 4. Spawn: claude -p --agent {agentId} {prompt}                          │
│ 5. Timeout: 30 minutes                                                   │
│ 6. Capture stdout → output                                              │
│ 7. Record: success/failure                                              │
│ 8. Update: CircuitBreaker state                                         │
│ 9. Clean: Remove worktree                                               │
│                                                                          │
│ Return: ExecutionResult { success, output, durationMs }                 │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ ExecutionResult (primary)
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ MULTI-STAGE ORCHESTRATOR                                                │
│                                                                          │
│ STAGE 1: PRIMARY (Already Done)                                         │
│ ├─ result = ExecutionResult from AgentExecutor                          │
│ └─ if !success: return early (no review/verify)                         │
│                                                                          │
│ P2P CHECK:                                                               │
│ ├─ Parse primary.output for DELEGATE blocks                            │
│ │  (format: <!-- DELEGATE to expert-X: ...content... -->)              │
│ └─ if delegations found:                                               │
│    ├─ P2PRouter.route(delegations)                                     │
│    └─ Append P2P outputs to primary.output                             │
│                                                                          │
│ STAGE 2: REVIEW (Best-Effort, Timeout 5min)                            │
│ ├─ Prompt: "Review for correctness, completeness"                      │
│ ├─ Model: Codex (GPT, via CLI)                                         │
│ ├─ Result: PASS / NEEDS_IMPROVEMENT / FAIL                             │
│ └─ Status: ok | timeout | error | skipped                              │
│                                                                          │
│ STAGE 3: VERIFY (Best-Effort, Timeout 5min)                            │
│ ├─ Prompt: "Verify for factual accuracy, logic"                        │
│ ├─ Model: Gemini (via API)                                             │
│ ├─ Result: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED                  │
│ └─ Status: ok | timeout | error | skipped                              │
│                                                                          │
│ CONVERGENCE CHECK (RalphLoop):                                          │
│ ├─ if verify.output == undefined: skip                                 │
│ ├─ if "VERIFIED" in verify.output (not "UNVERIFIED"): converged! ✓     │
│ └─ else: enter retry loop                                              │
│                                                                          │
│ RETRY LOOP (max 5 iterations):                                          │
│ ├─ Detect stagnation (same verify output twice): exit                  │
│ ├─ Append verify feedback to task.message.content                      │
│ ├─ Re-run primary (AgentExecutor) with feedback                        │
│ ├─ Re-verify (Stage 3 again)                                           │
│ ├─ Converged? (VERIFIED): exit loop                                    │
│ └─ Max iterations? (5): exit loop (convergedReason=max-iterations)    │
│                                                                          │
│ Return: MultiStageResult {                                              │
│   success,                                                               │
│   primary,                 # ExecutionResult                            │
│   review,                  # StageResult                                │
│   verify,                  # StageResult                                │
│   summary,                 # All outputs combined                       │
│   convergedReason,         # verified|quality-gates|stagnation|...    │
│ }                                                                        │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ MultiStageResult
                         │
┌────────────────────────▼────────────────────────────────────────────────┐
│ PROJECT ROUTER (Response Phase)                                         │
│ ├─ result.success?                                                      │
│ │  ├─ Yes: message.replyFn(formatSuccess(...))                         │
│ │  └─ No:  message.replyFn(formatError(...))                           │
│ └─ Notify: health.notifier.send({ title, body, level, ... })           │
│                                                                          │
│ CHANNEL ADAPTER (Sends Reply)                                           │
│ ├─ Slack: bot.client.chat.postMessage()                                │
│ ├─ Discord: message.reply()                                            │
│ ├─ Telegram: ctx.reply()                                               │
│ ├─ Email: nodemailer.sendMail()                                        │
│ ├─ Webhook: HTTP POST response                                         │
│ └─ CLI: Print to stdout                                                │
│                                                                          │
│ Task Complete ✓                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Request Processing State Machine

```
Message Received
  │
  ├─ [INGESTION]
  │  ├─ Channel adapter normalizes → ChannelMessage
  │  └─ Pass to router.handleMessage()
  │
  ├─ [DISPATCH]
  │  ├─ Match project (registry lookup)
  │  ├─ If no match: create new project (git repo + registry entry)
  │  ├─ Detect domain (content regex matching)
  │  ├─ Get agent for domain (registry mapping)
  │  └─ Enqueue to project queue
  │
  ├─ [QUEUED]
  │  ├─ Wait for queue to be empty (concurrency=1 per project)
  │  └─ Meanwhile: other projects execute in parallel
  │
  ├─ [EXECUTION] ─── Primary Agent (claude)
  │  ├─ Check circuit breaker
  │  ├─ Create worktree (git isolation)
  │  ├─ Spawn subprocess: claude --agent {agentId}
  │  ├─ Stream output (30min timeout)
  │  ├─ Capture result
  │  └─ Update circuit breaker
  │
  ├─ [P2P_ROUTING] (if DELEGATE blocks found)
  │  ├─ Parse delegations from primary.output
  │  └─ Route to other agents (P2P network)
  │
  ├─ [REVIEW] ──── Secondary Model (codex, best-effort)
  │  ├─ Timeout: 5 minutes
  │  ├─ Prompt: assess correctness/completeness
  │  └─ Result: PASS / NEEDS_IMPROVEMENT / FAIL
  │
  ├─ [VERIFY] ──── Tertiary Model (gemini, best-effort)
  │  ├─ Timeout: 5 minutes
  │  ├─ Prompt: verify factual accuracy
  │  └─ Result: VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED
  │
  ├─ [CONVERGENCE] ─── RalphLoop Decision
  │  ├─ VERIFIED? → CONVERGED ✓
  │  ├─ Stagnation (same output)? → CONVERGED (gave up)
  │  ├─ Max iterations (5)? → CONVERGED (timeout)
  │  └─ Feedback available? → RETRY (loop back to EXECUTION)
  │
  └─ [RESPONSE]
     ├─ Format result (add emojis, markdown)
     ├─ Send via message.replyFn() to channel
     ├─ Send notification to health daemon
     └─ Task Complete ✓
```

---

## Data Flow Diagram: Queue & Concurrency

```
Time →

PROJECT A             PROJECT B             PROJECT C
┌──────────┐          ┌──────────┐          ┌──────────┐
│ Job A.1  │          │ Job B.1  │          │ Job C.1  │
│EXECUTING │          │ QUEUED   │          │ QUEUED   │
│(2min)    │          │          │          │          │
└──────────┘          └──────────┘          └──────────┘
     │
(1min)
     │
     ├─ Job A.1 completes
     │
     ├─ Job A.2 starts EXECUTING
     │  (at same time B.1 and C.1 can start if available)
     │
┌────▼────────────────────────────────────────────────────┐
│          PARALLEL EXECUTION (Different Projects)        │
│                                                          │
│ Project A: Job A.2 EXECUTING           (0-3min)        │
│ Project B: Job B.1 EXECUTING           (0-2min)        │
│ Project C: Job C.1 EXECUTING           (0-1min)        │
│                                                          │
│ All three projects work concurrently                    │
│ No blocking between projects                            │
│ But within A: A.3 waits for A.2 to finish              │
└────────────────────────────────────────────────────────┘
```

**Key Property**: FIFO per project, parallel across projects.

---

## State Transitions: Task Lifecycle

```
┌──────────────┐
│ PENDING      │ (Queued, waiting for executor)
└──────┬───────┘
       │ Dequeued
       ▼
┌──────────────┐
│ RUNNING      │ (Primary stage executing)
└──────┬───────┘
       │ Primary complete
       ▼
┌──────────────┐
│ REVIEW       │ (Secondary stage, optional, best-effort)
└──────┬───────┘
       │ Review timeout or error
       ▼
┌──────────────┐
│ VERIFY       │ (Tertiary stage, optional, best-effort)
└──────┬───────┘
       │ Verify complete
       ▼
┌──────────────┐
│ CONVERGE     │ (RalphLoop decision)
│ CHECKING     │
└──────┬───────┘
       │ Converged (verified or stagnated)
       ▼
┌──────────────┐
│ COMPLETED    │ (Success or failure, reply sent)
│              │
│ Success: primary.success &&                │
│          (verify skipped OR verify PASS)   │
│                                             │
│ Failure: primary failed OR                 │
│          (verify failed AND max retries)   │
└──────────────┘
```

---

## Queue Data Structure

**Per-Project Queue**:
```typescript
class ProjectQueue {
  private queues: Map<projectId, PQueue>

  async enqueue(projectId: string, message: ChannelMessage, job: () => Promise<void>) {
    // Get or create queue for projectId
    let q = this.queues.get(projectId)
    if (!q) {
      q = new PQueue({ concurrency: 1 })  // FIFO, one at a time
      this.queues.set(projectId, q)
    }

    // Add to queue (will wait if others executing)
    await q.add(() => job())
  }
}
```

**Behavior**:
- New project → new queue
- Message arrives → add to queue
- If queue empty → execute immediately
- If queue busy → wait in queue (FIFO)

---

## Worktree Isolation Data Flow

```
Task Execution
  │
  ├─ WorktreeManager.create(projectPath, taskId)
  │  ├─ git worktree add ../.claude/worktrees/{taskId}
  │  └─ Return worktreePath
  │
  ├─ Spawn claude CLI in worktreePath
  │  ├─ cwd = worktreePath (or projectPath if worktree fails)
  │  └─ All file changes isolated to worktree
  │
  ├─ Agent executes in isolation
  │  ├─ Create files → worktree
  │  ├─ Commit changes → worktree branch
  │  ├─ No effect on main branch
  │  └─ No conflict with other tasks
  │
  └─ WorktreeManager.remove(projectPath, taskId)
     ├─ git worktree remove ../.claude/worktrees/{taskId}
     └─ Branch and files deleted (cleanup)
```

**Key**: Each task is completely isolated. Parallel tasks never interfere.

---

## Health Monitoring Data Flow

```
Every 10 minutes:
  │
  ├─ HealthMonitor.check()
  │  ├─ Get router.getActiveProjects() → [projectIds]
  │  ├─ Get router.getQueueStats() → queue depth per project
  │  ├─ Get CircuitBreakerRegistry.getStates() → agent health
  │  └─ Compute HealthStatus (uptime, healthy flag)
  │
  ├─ TaskDiscovery.check()
  │  ├─ Scan all project directories
  │  ├─ Look for .task or incomplete-* markers
  │  ├─ If found: infer task content
  │  └─ Re-enqueue: router.handleDiscoveredTask(syntheticMessage)
  │
  ├─ ProcessWatcher.check()
  │  ├─ Get list of tracked processes
  │  ├─ Check elapsed time (task timeout = 30min)
  │  └─ If timeout exceeded: process.kill(-pid, 'SIGKILL')
  │
  └─ HTTP Endpoint GET /health
     ├─ Return latest HealthStatus JSON
     └─ Used by load balancers / monitoring systems
```

---

## P2P Agent Delegation Data Flow

**If primary output contains DELEGATE blocks**:

```
Primary Agent Output:
  │
  ├─ <!-- DELEGATE to expert-researcher: "Find market trends for X" -->
  ├─ <!-- DELEGATE to expert-designer: "Create UI mockup" -->
  │
  └─ Other output...
     │
     └─ P2PRouter.parse(output)
        ├─ Extract all DELEGATE blocks
        └─ Return Delegation[] array
           │
           └─ P2PRouter.route(delegations)
              ├─ For each delegation:
              │  ├─ Extract target agent (expert-researcher)
              │  ├─ Extract content ("Find market trends...")
              │  ├─ Spawn that agent (like primary)
              │  └─ Capture result
              │
              └─ Append all P2P results to primary.output
                 └─ Pass combined output to review/verify stages
```

**Effect**: One primary agent can delegate to many specialists, all results combined.

---

## Circuit Breaker State Machine

```
CLOSED (Normal) ────────────────────┐
  │                                 │
  ├─ Success? → Stay CLOSED         │
  └─ Failure? → count++             │
     └─ count >= 5? → OPEN ↓        │
                                    │
OPEN (Circuit Open) ◄──────────────┘
  │ (New requests rejected)
  │
  ├─ Reject task: "Circuit breaker OPEN"
  └─ Wait for recovery signal
     └─ Timeout-based: try again after interval
        └─ 1 Success? → HALF_OPEN → CLOSED
```

**Effect**: Failing agents are deprioritized; system tries alternative agents.

---

## RalphLoop Convergence Detection

```
Verify Output Received
  │
  ├─ if output contains "VERIFIED" (not "UNVERIFIED")
  │  └─ → Converged ✓ (verified)
  │
  ├─ else if (previousOutput == currentOutput)
  │  └─ → Converged ✓ (stagnation)
  │
  ├─ else if iterations >= maxIterations (5)
  │  └─ → Converged ✓ (timeout)
  │
  └─ else
     └─ Append feedback to task
        └─ Re-run primary with feedback
           └─ Re-verify
              └─ (Loop back to top)
```

**Key**: Prevents infinite loops while allowing useful feedback iterations.

---

## State Persistence

**In-Memory**:
- Active queues
- Circuit breaker states
- Process tracking
- Health monitor readings

**Persistent (Disk)**:
- Project registry (`registry/projects.json`)
- Agent registry (`registry/agents.json`)
- Project git repos (full history)
- Dynamic agents (`.claude/agents/moai/*.md`)

**Lost on Restart**:
- Queued but not-executing tasks
- In-progress agent executions (killed)
- Circuit breaker counters (reset to 0)

---

**Version**: 0.1.0
**Last Updated**: 2026-03-21
