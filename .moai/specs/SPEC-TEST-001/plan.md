---
id: SPEC-TEST-001
version: "1.0.0"
status: draft
created: "2026-03-21"
updated: "2026-03-21"
author: hackit
priority: high
---

# SPEC-TEST-001: 구현 계획 - 테스트 커버리지 확장

## 1. 개요

OpenAgora 프로젝트의 테스트 커버리지를 현재 약 9%에서 80%까지 단계적으로 확장한다. DDD 방법론에 따라 characterization tests를 우선 작성하여 기존 동작을 보존하고, 이후 specification tests로 확장한다.

## 2. 기술 스택

| 도구 | 버전 | 용도 |
|------|------|------|
| Vitest | 4.1 | 테스트 러너, assertion |
| `vi.mock` | Vitest 내장 | 모듈 mocking |
| `vi.spyOn` | Vitest 내장 | 함수 스파이 |
| `vi.useFakeTimers` | Vitest 내장 | 타이머 제어 |
| `vi.fn` | Vitest 내장 | mock 함수 생성 |

### 기존 테스트에서 확인된 패턴

**Logger Mocking 패턴**:

```typescript
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
```

**Fake Timers 패턴**:

```typescript
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
// 시간 전진
vi.setSystemTime(now + 60_000);
```

**비동기 조율 패턴**:

```typescript
let resolve: () => void;
const blocking = new Promise<void>(r => { resolve = r; });
// 테스트 내에서 resolve() 호출로 진행 제어
```

**Fixture 팩토리 패턴**:

```typescript
function makeMessage(id: string): ChannelMessage {
  return { id, channel: 'test', content: `msg-${id}`, /* ... */ };
}
```

---

## 3. Phase 구성

### Phase 1: 테스트 인프라 + P1 핵심 모듈

**Primary Goal (최우선 목표)**

**범위**: 공유 유틸리티 생성 + 5개 핵심 모듈 테스트 작성

**산출물**:

| 작업 | 예상 테스트 수 | 파일 |
|------|--------------|------|
| 공유 fixtures/helpers | - | `src/__tests__/fixtures.ts`, `mock-adapters.ts`, `test-helpers.ts` |
| AgentExecutor | ~15 | `src/agents/__tests__/executor.test.ts` |
| MultiStageOrchestrator | ~15 | `src/models/__tests__/multi-stage.test.ts` |
| ProjectRouter | ~12 | `src/router/__tests__/project-router.test.ts` |
| HealthDaemon | ~10 | `src/health/__tests__/daemon.test.ts` |
| AdapterManager | ~8 | `src/adapters/__tests__/adapter-manager.test.ts` |

**Phase 1 합계**: 약 60개 테스트
**목표 커버리지**: 35%

**기술 접근**:

1. 공유 유틸리티 먼저 작성하여 이후 모든 테스트에서 재사용
2. AgentExecutor: `child_process.spawn`을 `vi.mock`으로 대체, CircuitBreaker 연동은 실제 인스턴스 사용
3. MultiStageOrchestrator: 각 stage 함수를 `vi.spyOn`으로 감시, 파이프라인 흐름 검증
4. ProjectRouter: 메시지 fixture 생성, 프로젝트 매칭 로직 단위 테스트
5. HealthDaemon: `vi.useFakeTimers`로 주기적 체크 시뮬레이션, HTTP 서버는 mock
6. AdapterManager: MockAdapter 활용, 생명주기 이벤트 순서 검증

---

### Phase 2: P2 어댑터 모듈

**Secondary Goal (차선 목표)**

**범위**: 4개 어댑터 테스트 작성

**산출물**:

| 작업 | 예상 테스트 수 | 파일 |
|------|--------------|------|
| SlackAdapter | ~10 | `src/adapters/__tests__/slack-adapter.test.ts` |
| DiscordAdapter | ~8 | `src/adapters/__tests__/discord-adapter.test.ts` |
| WebhookAdapter | ~10 | `src/adapters/__tests__/webhook-adapter.test.ts` |
| TelegramAdapter | ~7 | `src/adapters/__tests__/telegram-adapter.test.ts` |

**Phase 2 합계**: 약 35개 테스트 (누적 약 95개)
**목표 커버리지**: 50%

**기술 접근**:

1. 각 어댑터의 외부 API 호출을 `vi.mock`으로 대체
2. SlackAdapter: `@slack/web-api` mock, 이벤트 파싱 검증
3. DiscordAdapter: `discord.js` Client mock, 메시지 이벤트 핸들링
4. WebhookAdapter: HTTP 요청/응답 mock, 서명 검증 로직 테스트
5. TelegramAdapter: Bot API mock, long polling 시뮬레이션

**의존성**: Phase 1의 `mock-adapters.ts` 완료 필요

---

### Phase 3: P2 에이전트/헬스 모듈

**Tertiary Goal (3차 목표)**

**범위**: 5개 에이전트/헬스 모듈 테스트 작성

**산출물**:

| 작업 | 예상 테스트 수 | 파일 |
|------|--------------|------|
| AgentRegistry | ~8 | `src/agents/__tests__/registry.test.ts` |
| P2PRouter | ~10 | `src/agents/__tests__/p2p-router.test.ts` |
| RalphLoop | ~12 | `src/health/__tests__/ralph-loop.test.ts` |
| Notifier | ~8 | `src/health/__tests__/notifier.test.ts` |
| ProjectRegistry | ~7 | `src/router/__tests__/registry.test.ts` |
| HealthMonitor | ~10 | `src/health/__tests__/health-monitor.test.ts` |
| TaskDiscovery | ~10 | `src/health/__tests__/task-discovery.test.ts` |

**Phase 3 합계**: 약 65개 테스트 (누적 약 160개)
**목표 커버리지**: 65%

**기술 접근**:

1. AgentRegistry: Map 기반 CRUD 동작 검증
2. P2PRouter: 에이전트 간 메시지 라우팅 로직, AgentRegistry 연동
3. RalphLoop: `vi.useFakeTimers`로 반복 실행 시뮬레이션, 수렴 조건 검증
4. Notifier: 알림 채널 mock, 쿨다운 로직 검증
5. ProjectRegistry: 프로젝트 매칭 알고리즘 단위 테스트

---

### Phase 4: P3 보조 모듈 + 통합 테스트

**Optional Goal (선택 목표)**

**범위**: 나머지 모듈 + 모듈 간 통합 테스트

**산출물**:

| 작업 | 예상 테스트 수 | 파일 |
|------|--------------|------|
| EmailAdapter | ~5 | `src/adapters/__tests__/email-adapter.test.ts` |
| CLIAdapter | ~5 | `src/adapters/__tests__/cli-adapter.test.ts` |
| WorktreeManager | ~8 | `src/health/__tests__/worktree.test.ts` |
| ProcessWatcher | ~7 | `src/health/__tests__/process-watcher.test.ts` |
| 통합 테스트 | ~35 | `src/__tests__/integration/` |

**Phase 4 합계**: 약 60개 테스트 (누적 약 220개)
**목표 커버리지**: 80%

**통합 테스트 시나리오**:

- 메시지 수신 -> ProjectRouter -> AgentExecutor -> 응답 반환 전체 흐름
- AdapterManager -> Adapter -> ChannelMessage 변환 전체 흐름
- HealthDaemon -> HealthMonitor -> Notifier 알림 전체 흐름
- MultiStageOrchestrator -> P2PRouter -> AgentExecutor 위임 전체 흐름

---

## 4. 리스크 분석

### 리스크 1: 외부 API Mocking 복잡성

- **설명**: Slack, Discord, Telegram API의 복잡한 응답 구조를 정확히 mock하기 어려울 수 있음
- **영향**: 테스트 신뢰도 저하, 실제 환경과 불일치
- **대응**: 각 API의 실제 응답 구조를 문서에서 확인하여 fixture 생성, 타입 정의 활용

### 리스크 2: Subprocess 테스트

- **설명**: AgentExecutor의 `child_process.spawn` 호출을 mock하면 실제 동작과 차이 발생 가능
- **영향**: 프로세스 생명주기 관련 버그 누락 가능
- **대응**: spawn 동작의 핵심 시나리오(성공, 실패, 타임아웃, 시그널)를 mock으로 시뮬레이션, 통합 테스트에서 보완

### 리스크 3: Timer 의존 코드

- **설명**: HealthDaemon, RalphLoop 등 주기적 실행 코드는 타이밍에 민감
- **영향**: Fake timers 사용 시 실제 비동기 동작과 차이 발생 가능
- **대응**: `vi.useFakeTimers` + `vi.advanceTimersByTime` 조합 사용, `flushPromises` 헬퍼로 비동기 완료 보장

### 리스크 4: 모듈 간 결합도

- **설명**: ProjectRouter -> AgentExecutor -> CircuitBreaker 등 깊은 의존 체인
- **영향**: 단위 테스트에서 과도한 mocking 필요
- **대응**: 의존성 경계에서 mock 주입, 통합 테스트에서 실제 연결 검증

### 리스크 5: 테스트 실행 시간

- **설명**: 220개 이상의 테스트 실행 시간이 60초를 초과할 수 있음
- **영향**: CI/CD 파이프라인 지연, 개발자 피드백 루프 저하
- **대응**: 파일별 병렬 실행, fake timers로 실제 대기 제거, 통합 테스트 분리 실행 옵션

---

## 5. 참고 구현

### 기존 테스트 파일 참고

| 참고 파일 | 활용 패턴 |
|----------|----------|
| `src/queue/__tests__/project-queue.test.ts` | 비동기 조율 (Promise resolver), 동시성 테스트 |
| `src/health/__tests__/circuit-breaker.test.ts` | 상태 머신 테스트, fake timers, 임계값 검증 |
| `src/models/__tests__/model-router.test.ts` | 환경변수 mock, 역량 기반 라우팅 검증 |

### Vitest 설정 확인

```bash
# 테스트 실행
npx vitest run

# 커버리지 측정
npx vitest run --coverage

# 특정 파일 테스트
npx vitest run src/agents/__tests__/executor.test.ts
```

---

## 6. 다음 단계

1. SPEC 검토 후 `/moai:2-run SPEC-TEST-001`으로 Phase 1 구현 시작
2. Phase 1 완료 후 커버리지 35% 달성 확인
3. Phase 2~4는 순차적으로 진행하며, 각 Phase 완료 시 커버리지 게이트 검증
