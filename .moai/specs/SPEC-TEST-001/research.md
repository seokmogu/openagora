---
id: SPEC-TEST-001
type: research-summary
created: "2026-03-21"
author: hackit
---

# SPEC-TEST-001: 리서치 요약

## 1. 커버리지 갭 분석

### 현재 테스트 상태

- **전체 커버리지**: 약 9% (3개 파일, 약 21개 테스트)
- **테스트 프레임워크**: Vitest 4.1
- **개발 모드**: DDD (characterization tests, < 10% coverage)

### 기존 테스트 파일

| 파일 | 핵심 검증 항목 |
|------|---------------|
| `src/queue/__tests__/project-queue.test.ts` | 동시성 제어, enqueue 동작, Promise 기반 비동기 조율 |
| `src/health/__tests__/circuit-breaker.test.ts` | 상태 머신 전환(CLOSED->OPEN->HALF_OPEN), 임계값, fake timers |
| `src/models/__tests__/model-router.test.ts` | 모델 역량 라우팅, 환경변수 기반 설정, fallback |

### 미테스트 모듈 분류

**P1 (핵심)** - 5개 모듈:
- AgentExecutor: claude subprocess 실행, circuit breaker 연동, worktree 격리
- MultiStageOrchestrator: 3단계 파이프라인, RalphLoop 통합, P2P 위임
- ProjectRouter: 메시지 디스패치, 프로젝트 매칭
- HealthDaemon: 시작/종료, 헬스 체크, HTTP 서버
- AdapterManager: 어댑터 생명주기 관리

**P2 (중요)** - 9개 모듈:
- 어댑터: Slack, Discord, Webhook, Telegram
- 에이전트: AgentRegistry, P2PRouter
- 헬스: RalphLoop, Notifier, ProjectRegistry

**P3 (보조)** - 7개 모듈:
- 어댑터: Email, CLI
- 헬스: HealthMonitor, TaskDiscovery, WorktreeManager, ProcessWatcher
- 기타: BuilderAgent

## 2. 기존 테스트 패턴 분석

### 핵심 패턴 4가지

1. **Logger mocking**: `vi.mock('../../utils/logger.js', () => ({ logger: { info: vi.fn(), ... } }))`
2. **Fake timers**: `vi.useFakeTimers()` + `vi.setSystemTime(now + delta)`
3. **비동기 조율**: Promise resolver 패턴으로 실행 순서 제어
4. **Fixture 팩토리**: `function makeMessage(id): ChannelMessage { ... }`

### 소스 모듈 구조

```
src/
  adapters/: base.ts, cli.ts, discord.ts, email.ts, manager.ts, slack.ts, telegram.ts, webhook.ts
  agents/: builder-agent.ts, executor.ts, p2p-router.ts, registry.ts
  health/: circuit-breaker.ts, daemon.ts, health-monitor.ts, notifier.ts, process-watcher.ts, ralph-loop.ts, task-discovery.ts, worktree.ts
  models/: multi-stage.ts, router.ts
  queue/: (project-queue 등)
  router/: project-creator.ts, project-router.ts, registry.ts
```

## 3. 주요 기술적 고려사항

- AgentExecutor는 `child_process.spawn`을 사용하므로 반드시 mock 필요
- HealthDaemon은 HTTP 서버와 타이머를 모두 사용하므로 fake timers + HTTP mock 조합 필요
- MultiStageOrchestrator는 깊은 의존 체인을 가지므로 단위 테스트 시 경계에서 mock 주입
- 어댑터들은 각각 다른 외부 SDK를 사용하므로 SDK별 mock 전략 필요
