# OpenAgora Data Flow

## Core Message Lifecycle

### Flow: User Message → Agent Response

```
┌─────────────────────────────────────────────────────────────────┐
│ PHASE 1: INPUT & NORMALIZATION                                  │
└─────────────────────────────────────────────────────────────────┘

1. User sends message in external channel
   └─ Slack: /run my-project Do something
   └─ Discord: @agora /run my-project Do something
   └─ Telegram: /run my-project Do something
   └─ Email: To: agora@company.com (subject + body)
   └─ Webhook: POST http://localhost:3000/webhook
   └─ CLI: Type message to stdin

   ↓ (Adapter-specific handler)

2. Adapter normalizes to ChannelMessage
   {
     id: "msg-uuid",
     channel: "slack" | "discord" | etc.,
     channelId: "C123456" | "123456789",
     userId: "U123456",
     content: "Do something",
     timestamp: Date.now(),
     metadata: { slack_thread_ts: "1234.567" },
     replyFn: async (text) => {
       // SlackClient.postMessage(channelId, text)
       // DiscordChannel.send(text)
       // TelegramChat.sendMessage(text)
       // etc.
     }
   }

   ↓ (AdapterManager routes all to ProjectRouter)

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 2: ROUTING & PROJECT MANAGEMENT                           │
└─────────────────────────────────────────────────────────────────┘

3. ProjectRouter.handleMessage(channelMessage)
   
   3a. Parse command
       input: "Do something"
       └─ Check if message matches /run, /setup, /list, /help
       └─ Extract: command, projectName, taskDescription
   
   3b. Lookup or create project
       if command === "/run":
         projectId = derive from (channel + userId)
         project = ProjectRegistry.getProject(projectId)
         
         if project not found:
           project = ProjectCreator.create(
             name: projectName,
             domain: guess from taskDescription,
             githubRepo: lookup from config
           )
           ProjectRegistry.saveProject(project)
         
         [Project created event logged]
   
   3c. Select agent for task
       agents = AgentRegistry.listAgents(project.domain)
       
       if agents.length === 0:
         agent = BuilderAgent.create(project.domain)
         [Dynamic agent creation logged]
       else:
         agent = agents[0]  // Primary agent for domain
   
   ↓ (ProjectRouter enqueues task)

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 3: TASK QUEUEING & BUFFERING                              │
└─────────────────────────────────────────────────────────────────┘

4. ProjectRouter enqueues task to per-project queue
   
   ProjectQueue.enqueue(projectId, {
     id: "task-uuid",
     projectId: projectId,
     message: channelMessage,
     priority: 0,  // FIFO
     enqueuedAt: Date.now(),
     status: "pending"
   })
   
   [Task enqueued event logged with queue depth]
   
   Project Queue Structure:
   
   ProjectQueue {
     queues: Map<projectId, QueuedTask[]> {
       "project-1": [task1, task2, task3],
       "project-2": [task4],
       "project-3": [task5, task6, task7, task8]
     }
   }

   ↓ (Router dequeues tasks from all projects in round-robin)

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 4: AGENT EXECUTION & SUBPROCESS SPAWNING                  │
└─────────────────────────────────────────────────────────────────┘

5. ProjectRouter.processQueue() runs on interval (e.g., 100ms)
   
   for each project in ProjectQueue:
     if (project has pending tasks) && (project not running):
       task = ProjectQueue.dequeue(projectId)
       task.status = "running"
       
       ↓ (Check circuit breaker)
       
       breaker = CircuitBreakerRegistry.get(agentId)
       if breaker.isOpen():
         task.status = "failed"
         message.replyFn("Circuit breaker open, try again later")
         continue
       
       [Circuit breaker status: ${breaker.state}]
       
       ↓ (Spawn subprocess)

6. AgentExecutor.run(task, agentId, projectPath)
   
   6a. Build prompt from context
       prompt = {
         task: task.message.content,
         projectPath: project.path,
         projectDomain: project.domain,
         availableAgents: project.agents.map(id => AgentRegistry.get(id))
       }
   
   6b. Spawn subprocess with 30-minute timeout
       const child = spawn('claude', [
         '--api-key', process.env.CLAUDE_API_KEY,
         '--prompt', JSON.stringify(prompt),
         '--project-path', project.path
       ])
       
       ProcessWatcher.track(child.pid, agentId)
       timeout_handle = setTimeout(() => {
         if (child.kill() failed):
           process.kill(child.pid, 'SIGKILL')
       }, 30 * 60 * 1000)
   
   6c. Capture output
       output = ''
       child.stdout.on('data', chunk => output += chunk)
       child.stderr.on('data', chunk => output += chunk)
   
   6d. Wait for completion or timeout
       await new Promise((resolve, reject) => {
         child.on('exit', (code) => {
           clearTimeout(timeout_handle)
           ProcessWatcher.untrack(child.pid)
           resolve(code)
         })
       })
   
   [Agent execution completed: ${agentId}, duration: ${durationMs}ms]
   
   ExecutionResult = {
     taskId: task.id,
     agentId: agentId,
     success: (exit code === 0),
     output: captured_output,
     durationMs: Date.now() - startMs
   }

   ↓ (Circuit breaker records result)

7. CircuitBreakerRegistry records result
   
   if success:
     breaker.recordSuccess()
     breaker.state = "CLOSED"
   else:
     breaker.recordFailure()
     if breaker.failureCount >= 5:
       breaker.state = "OPEN"
   
   [Circuit breaker state change: ${agentId} → ${breaker.state}]

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 5: MULTI-STAGE ORCHESTRATION & QUALITY GATES              │
└─────────────────────────────────────────────────────────────────┘

8. MultiStageOrchestrator.executeStages(task, agentId)
   
   8a. STAGE 1: PRIMARY (Always executes)
       result = AgentExecutor.run(task, agentId, projectPath)
       primary = result
       
       if primary.success:
         proceed to review
       else:
         skip to result synthesis
   
   8b. STAGE 2: REVIEW (Optional, 5-min timeout)
       modelRoute = ModelRouter.routeByDomain(project.domain)
       reviewModel = modelRoute.review
       
       if reviewModel not available:
         review = { status: "skipped" }
       else:
         review_result = AgentExecutor.run(
           task: { ...task, inputToPrevious: primary.output },
           agentId: reviewModel,
           timeout: 5 * 60 * 1000
         )
         
         if timed out:
           review = { status: "timeout" }
         else:
           review = { 
             status: review_result.success ? "ok" : "error",
             output: review_result.output
           }
   
   8c. STAGE 3: VERIFY (Optional, 5-min timeout)
       verifyModel = modelRoute.verify
       
       if reviewModel not available || primary+review already confirmed:
         verify = { status: "skipped" }
       else:
         verify_result = AgentExecutor.run(
           task: { ...task, inputToVerify: review.output },
           agentId: verifyModel,
           timeout: 5 * 60 * 1000
         )
         
         if timed out:
           verify = { status: "timeout" }
         else:
           verify = { 
             status: verify_result.success ? "ok" : "error",
             output: verify_result.output
           }
   
   8d. Stagnation Detection (Ralph Loop)
       iterations = [primary, review, verify].filter(r => r.success).length
       
       if iterations >= 3:
         convergedReason = "verified"
         break  // All stages succeeded
       
       if RalphLoop.isStagnant():
         convergedReason = "stagnation"
         break  // No progress detected
       
       if qualityMetrics.pass:
         convergedReason = "quality-gates"
         break  // Quality threshold met

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 6: RESULT SYNTHESIS & OUTPUT                              │
└─────────────────────────────────────────────────────────────────┘

9. MultiStageOrchestrator synthesizes final result
   
   summary = synthesize(
     primary.output,
     review?.output,
     verify?.output,
     convergedReason
   )
   
   multiStageResult = {
     taskId: task.id,
     agentId: agentId,
     success: primary.success && !review.error && !verify.error,
     primary: primary,
     review: review,
     verify: verify,
     summary: summary,
     durationMs: elapsed,
     iterations: iteration_count,
     convergedReason: convergedReason
   }
   
   [Multi-stage orchestration completed: ${iterations} iterations, ${convergedReason}]

   ↓ (Update task status)

10. Update task status in registry
    
    task.status = multiStageResult.success ? "completed" : "failed"
    task.result = multiStageResult
    ProjectRegistry.updateTask(task)
    
    [Task completed: ${task.id}, success: ${task.status}]

┌─────────────────────────────────────────────────────────────────┐
│ PHASE 7: REPLY TO USER (Back to original channel)               │
└─────────────────────────────────────────────────────────────────┘

11. Send result back to user
    
    replyText = format_for_channel(multiStageResult.summary)
    
    await channelMessage.replyFn(replyText)
    
    // SlackAdapter: message.client.chat.postMessage()
    // DiscordAdapter: interaction.editReply()
    // TelegramAdapter: context.reply()
    // etc.
    
    [Reply sent to user via ${channel}]
```

## Error Propagation

### Error at Each Phase

```
PHASE 1: INPUT NORMALIZATION
├─ Adapter fails to connect → Log warning, skip adapter
├─ Message format invalid → Log error, reply to user
└─ replyFn not callable → Log warning, no response

PHASE 2: ROUTING
├─ Project creation fails → Log error, reply to user
├─ Agent not found → Create builder agent, continue
└─ Invalid domain → Default to "general" domain

PHASE 3: QUEUEING
├─ Queue full → Reject with backpressure message
├─ Invalid task → Skip and log
└─ (Queue rarely fails if project exists)

PHASE 4: EXECUTION
├─ Circuit breaker open → Reply "try again later", no execution
├─ Subprocess spawn fails → Log error, mark task failed
├─ Timeout (30 min) → ProcessWatcher SIGKILL, mark failed
└─ Output capture fails → Log warning, empty output

PHASE 5: ORCHESTRATION
├─ Review stage timeout → Skip, use primary result
├─ Verify stage failure → Log warning, use primary+review
├─ Ralph Loop detects stagnation → Stop, return best result
└─ All stages fail → Return error summary

PHASE 6: SYNTHESIS
├─ Summary generation fails → Use raw primary output
└─ Task update fails → Log warning, continue

PHASE 7: REPLY
├─ Channel disconnected → Queue reply for later
├─ replyFn throws → Log error, cannot recover
└─ Rate limited by channel → Retry with backoff
```

## Health Check Flow

### Background Health Monitoring (10-minute interval)

```
HealthDaemon.start()
  ↓ (every 10 minutes)
  
1. HealthMonitor.gatherMetrics()
   - activeProjects = ProjectRegistry.listProjects().length
   - queueDepth = ProjectQueue.allQueues().reduce(q => q.size).sum
   - circuitBreakers = CircuitBreakerRegistry.getAll()
   - uptime = Date.now() - startTime
   - lastCheck = Date.now()

2. ProcessWatcher.checkProcesses()
   for each tracked process:
     - Check if process still alive (ps -p)
     - If dead > 30 min ago: mark failed
     - If running > 30 min: SIGKILL force
   
   [Process watch: ${alive}/${total} running]

3. TaskDiscovery.findOrphans()
   for each project in registry:
     for each task in task history:
       if (status === "running") && (lastUpdate > 1 hour ago):
         discoverCallback(task)
         └─ ProjectRouter.handleDiscoveredTask(task)
            └─ Resume task from checkpoint
   
   [Task discovery: ${found}/${checked} orphaned tasks]

4. RalphLoop.checkStagnation()
   if (queueDepth > threshold && no progress > 30 min):
     logger.warn('System stagnation detected')
     Notifier.alert('OpenAgora stagnation')

5. HealthStatus response includes:
   {
     healthy: (no circuit breakers open && queue reasonable),
     uptime: elapsed_seconds,
     activeProjects: count,
     queueDepth: total_pending,
     circuitBreakers: { agent-id: state },
     lastCheck: timestamp
   }

   [Health check complete: healthy=${status.healthy}]
```

## Data Structures in Motion

### ChannelMessage (Input)

```typescript
{
  id: "msg-550e8400-e29b-41d4-a716-446655440000",
  channel: "slack",
  channelId: "C123ABC",
  userId: "U456DEF",
  content: "/run myproject Implement user authentication",
  timestamp: 2026-03-23T10:30:00Z,
  metadata: {
    slack_thread_ts: "1234.567890",
    slack_team_id: "T789GHI"
  },
  replyFn: [AsyncFunction: handler for this channel]
}
```

### QueuedTask (Buffering)

```typescript
{
  id: "task-550e8400-e29b-41d4-a716-446655440001",
  projectId: "proj-slack-U456DEF",
  message: [ChannelMessage from above],
  priority: 0,
  enqueuedAt: 2026-03-23T10:30:05Z,
  status: "running",
  result?: {
    taskId: "task-...",
    agentId: "agent-default",
    success: true,
    primary: { output: "...", durationMs: 45000 },
    review: { status: "ok", output: "..." },
    verify: { status: "skipped" },
    summary: "Implementation complete",
    durationMs: 55000,
    iterations: 2,
    convergedReason: "verified"
  }
}
```

### MultiStageResult (Output)

```typescript
{
  taskId: "task-...",
  agentId: "agent-default",
  success: true,
  primary: {
    taskId: "task-...",
    agentId: "agent-default",
    success: true,
    output: "[Claude agent output]\n[Multiple lines of execution trace]",
    durationMs: 45000
  },
  review: {
    status: "ok",
    model: "gpt-4-turbo",
    output: "[Review feedback]",
    error: null
  },
  verify: {
    status: "skipped",
    model: "gemini-pro"
  },
  summary: "User authentication implementation reviewed and verified",
  durationMs: 55000,
  iterations: 2,
  convergedReason: "verified"
}
```

## Performance Characteristics

### Latency (p50/p95/p99)

| Phase | Operation | p50 | p95 | p99 |
|-------|-----------|-----|-----|-----|
| 1 | Adapter normalization | 5ms | 20ms | 100ms |
| 2 | Routing & project lookup | 10ms | 30ms | 50ms |
| 3 | Task queueing | 2ms | 5ms | 10ms |
| 4 | Agent execution | 30s | 45s | 60s |
| 5 | Multi-stage orchestration | 35s | 50s | 65s |
| 7 | Reply via channel | 100ms | 500ms | 2s |
| **Total** | End-to-end | 35s | 50s | 65s |

### Throughput

- **Input rate**: 100+ messages/sec (adapter limited)
- **Queue depth**: 1000+ tasks (memory permitting)
- **Concurrent executions**: 10+ agents (CPU bound)
- **Reply latency**: <500ms (network bound)

## Special Cases

### Case: Project Not Found → Auto-Create

```
User: "/run new-project Do something"
  ↓
CommandParser extracts: projectName="new-project"
  ↓
ProjectRouter.handleMessage()
  ↓
if project not in ProjectRegistry:
  ProjectCreator.create(
    name: "new-project",
    path: "${CWD}/projects/new-project",
    domain: guessFromContent("Do something") → "general",
    githubRepo: null
  )
  ↓
  ProjectRegistry.saveProject(project)
  ↓
  [New project created: new-project]
  ↓
Continue to agent selection
```

### Case: Agent Circuit Breaker Open

```
AgentExecutor.run(task, agentId, projectPath)
  ↓
breaker = CircuitBreakerRegistry.get(agentId)
  ↓
if breaker.isOpen():
  ↓
  return {
    taskId: task.id,
    agentId: agentId,
    success: false,
    output: "Circuit breaker OPEN. Agent temporarily unavailable.",
    durationMs: 1
  }
  ↓
  [Circuit rejection: ${agentId}]
  ↓
  task.status = "failed"
  ↓
  replyFn("Agent ${agentId} is experiencing issues. Please try again in 5 minutes.")
```

### Case: Multi-Stage Convergence (All Stages Pass)

```
Primary stage: SUCCESS
  ↓
Review stage: SUCCESS (confirms primary)
  ↓
Ralph Loop: No stagnation detected
  ↓
Verify stage: SUCCESS (confirms review)
  ↓
convergedReason = "verified"
  ↓
STOP - Return synthesized result with all three stage outputs
```

### Case: Multi-Stage Divergence (Ralph Loop Detects Stagnation)

```
Primary stage: SUCCESS
  ↓
Review stage: DIFFERENT (contradicts primary)
  ↓
Ralph Loop: detects loop back to primary output
  ↓
Iteration limit or timeout exceeded
  ↓
convergedReason = "stagnation"
  ↓
STOP - Return primary result with warning
  ↓
replyFn("Generated result with review disagreement (see details)")
```

## Message Flow Diagram (ASCII)

```
[User in Slack]
      ↓
[SlackAdapter.onMessage]
      ↓
[ChannelMessage: { channel: "slack", content: "/run...", replyFn }]
      ↓
[ProjectRouter.handleMessage]
      ↓
[ProjectRegistry.getOrCreate("proj-slack-userId")]
      ↓
[AgentRegistry.findAgent(domain)]
      ↓
[ProjectQueue.enqueue(projectId, task)]
      ↓
[ProcessQueue interval timer triggers]
      ↓
[ProjectQueue.dequeue(projectId)]
      ↓
[AgentExecutor.run(task, agentId, projectPath)]
      ↓
[spawn('claude', [prompts, args])]
      ↓
[ProcessWatcher.track(pid)]
      ↓
[Wait 30 minutes or until exit]
      ↓
[CircuitBreaker.recordSuccess/Failure]
      ↓
[MultiStageOrchestrator.executeStages]
      ├─ STAGE 1: Primary
      ├─ STAGE 2: Review (if primary success)
      ├─ STAGE 3: Verify (if review success)
      └─ Ralph Loop: Stagnation check
      ↓
[MultiStageResult synthesized]
      ↓
[Task marked completed/failed]
      ↓
[channelMessage.replyFn(summary)]
      ↓
[SlackClient.chat.postMessage]
      ↓
[User sees reply in Slack]
```
