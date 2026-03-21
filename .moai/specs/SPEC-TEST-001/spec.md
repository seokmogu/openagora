---
id: SPEC-TEST-001
version: "1.0.0"
status: draft
created: "2026-03-21"
updated: "2026-03-21"
author: hackit
priority: high
issue_number: 1
---

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| 1.0.0 | 2026-03-21 | hackit | 초기 SPEC 작성 |

---

# SPEC-TEST-001: OpenAgora 테스트 커버리지 확장

## 1. Environment (환경)

### 1.1 현재 상태

- **프로젝트**: OpenAgora - TypeScript/Node.js 멀티 에이전트 오케스트레이션 플랫폼
- **런타임**: Node.js + TypeScript
- **테스트 프레임워크**: Vitest 4.1
- **현재 커버리지**: 약 9% (3개 테스트 파일, 약 21개 테스트)
- **개발 모드**: DDD (characterization tests first, < 10% coverage)

### 1.2 기존 테스트 파일

| 파일 | 대상 모듈 | 테스트 수 | 상태 |
|------|-----------|-----------|------|
| `src/queue/__tests__/project-queue.test.ts` | ProjectQueue | ~7 | 동시성, enqueue |
| `src/health/__tests__/circuit-breaker.test.ts` | CircuitBreaker | ~7 | 상태 머신, 임계값 |
| `src/models/__tests__/model-router.test.ts` | ModelRouter | ~7 | 역량 라우팅, 환경변수 |

### 1.3 테스트 대상 모듈 목록

**핵심 모듈 (P1)**:
- `src/agents/executor.ts` - AgentExecutor
- `src/models/multi-stage.ts` - MultiStageOrchestrator
- `src/router/project-router.ts` - ProjectRouter
- `src/health/daemon.ts` - HealthDaemon
- `src/adapters/manager.ts` - AdapterManager

**중요 모듈 (P2)**:
- `src/adapters/slack.ts` - SlackAdapter
- `src/adapters/discord.ts` - DiscordAdapter
- `src/adapters/webhook.ts` - WebhookAdapter
- `src/adapters/telegram.ts` - TelegramAdapter
- `src/agents/registry.ts` - AgentRegistry
- `src/agents/p2p-router.ts` - P2PRouter

**보조 모듈 (P3)**:
- `src/health/ralph-loop.ts` - RalphLoop
- `src/health/notifier.ts` - Notifier
- `src/router/registry.ts` - ProjectRegistry
- `src/health/health-monitor.ts` - HealthMonitor
- `src/health/task-discovery.ts` - TaskDiscovery
- `src/health/worktree.ts` - WorktreeManager
- `src/adapters/email.ts` - EmailAdapter
- `src/adapters/cli.ts` - CLIAdapter

---

## 2. Assumptions (가정)

- **A1**: 모든 외부 의존성(Claude subprocess, Slack API, Discord API 등)은 mock으로 대체할 수 있다
- **A2**: Vitest 4.1의 `vi.mock`, `vi.spyOn`, `vi.useFakeTimers`로 충분한 테스트 격리가 가능하다
- **A3**: 기존 3개 테스트 파일의 패턴(Logger mocking, fake timers, fixture functions)을 일관되게 재사용한다
- **A4**: 테스트는 단위 테스트 중심으로 작성하며, 통합 테스트는 Phase 4에서 추가한다
- **A5**: CI/CD 파이프라인에서 전체 테스트 스위트 실행 시간은 60초 이내여야 한다
- **A6**: subprocess를 직접 spawn하는 테스트는 작성하지 않으며, spawn 호출을 mock 처리한다

---

## 3. Requirements (요구사항)

### 3.1 테스트 인프라 요구사항

#### REQ-INFRA-001: 공유 테스트 유틸리티 (UBIQUITOUS)

시스템은 **항상** 다음의 공유 테스트 유틸리티를 제공해야 한다:

- `src/__tests__/fixtures.ts`: 공통 메시지, 프로젝트, 에이전트 fixture 팩토리 함수
- `src/__tests__/mock-adapters.ts`: AdapterBase 기반 mock adapter 구현
- `src/__tests__/test-helpers.ts`: 비동기 테스트 헬퍼 (waitFor, flushPromises, createMockLogger)

#### REQ-INFRA-002: Logger Mocking 표준화 (UBIQUITOUS)

시스템은 **항상** 모든 테스트에서 일관된 Logger mocking 패턴을 사용해야 한다:

```typescript
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
```

#### REQ-INFRA-003: 테스트 파일 구성 (UBIQUITOUS)

시스템은 **항상** 각 모듈의 `__tests__/` 디렉토리에 테스트 파일을 배치해야 한다. 파일명은 `{module-name}.test.ts` 형식을 따른다.

---

### 3.2 P1 핵심 모듈 테스트 요구사항

#### REQ-P1-001: AgentExecutor 테스트 (EVENT-DRIVEN)

**WHEN** AgentExecutor가 에이전트 실행 요청을 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 정상 경로: subprocess spawn mock, 실행 결과 반환, 타임아웃 처리
- 에러 경로: subprocess 실패 시 CircuitBreaker 연동, 재시도 로직
- Worktree 격리: worktree 경로 생성 및 정리 동작
- 리소스 관리: 동시 실행 제한, 실행 큐 관리

#### REQ-P1-002: MultiStageOrchestrator 테스트 (COMPLEX)

**IF** MultiStageOrchestrator가 3단계 파이프라인을 실행 중이고 **AND WHEN** 각 단계에서 결과가 반환되면 **THEN** 시스템은 다음을 검증해야 한다:

- 파이프라인 흐름: 3단계 순차 실행 (분석 -> 처리 -> 응답)
- RalphLoop 통합: 반복 루프 진입/탈출 조건
- P2P 위임: 다른 에이전트로의 작업 위임 동작
- 단계 실패 처리: 중간 단계 실패 시 전체 파이프라인 롤백/에러 전파

#### REQ-P1-003: ProjectRouter 테스트 (EVENT-DRIVEN)

**WHEN** ProjectRouter가 메시지를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 프로젝트 매칭: 메시지 내용 기반 프로젝트 라우팅
- 에이전트 디스패치: 매칭된 프로젝트에 대한 에이전트 실행 위임
- 라우팅 실패: 매칭 실패 시 기본 동작 (fallback)
- 동시 메시지 처리: 다중 메시지 큐잉 및 순서 보장

#### REQ-P1-004: HealthDaemon 테스트 (COMPLEX)

**IF** HealthDaemon이 실행 중인 상태이고 **AND WHEN** 헬스 체크 주기가 도래하면 **THEN** 시스템은 다음을 검증해야 한다:

- 시작/종료: 데몬 시작, 정상 종료, 강제 종료 처리
- 헬스 체크: 주기적 상태 확인 실행 (fake timers 활용)
- HTTP 서버: 상태 엔드포인트 응답 검증
- 에러 복구: 헬스 체크 실패 시 재시도 및 알림 동작

#### REQ-P1-005: AdapterManager 테스트 (EVENT-DRIVEN)

**WHEN** AdapterManager가 어댑터 생명주기 이벤트를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 어댑터 등록/해제: 동적 어댑터 추가 및 제거
- 생명주기 관리: 초기화, 연결, 연결 해제, 정리 순서
- 메시지 라우팅: 수신 메시지의 올바른 어댑터 전달
- 다중 어댑터: 여러 어댑터 동시 관리 및 독립성

---

### 3.3 P2 어댑터 테스트 요구사항

#### REQ-P2-001: SlackAdapter 테스트 (EVENT-DRIVEN)

**WHEN** SlackAdapter가 Slack 메시지를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 메시지 수신: Slack 이벤트 파싱 및 ChannelMessage 변환
- 메시지 발신: 응답 메시지 Slack API 전송 (API mock)
- 인증: 토큰 검증 및 갱신 처리
- 에러 처리: API 오류, 네트워크 타임아웃, rate limiting 대응

#### REQ-P2-002: DiscordAdapter 테스트 (EVENT-DRIVEN)

**WHEN** DiscordAdapter가 Discord 메시지를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 메시지 수신: Discord 이벤트 파싱 및 ChannelMessage 변환
- 메시지 발신: 응답 메시지 Discord API 전송
- 봇 연결: 연결/재연결 동작 검증

#### REQ-P2-003: WebhookAdapter 테스트 (COMPLEX)

**IF** WebhookAdapter가 활성 상태이고 **AND WHEN** HTTP webhook 요청을 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 요청 검증: 서명 검증, 페이로드 파싱
- 메시지 변환: webhook 페이로드를 ChannelMessage로 변환
- 응답 전송: 콜백 URL로 결과 전송
- 보안: 잘못된 서명 거부, 페이로드 크기 제한

#### REQ-P2-004: TelegramAdapter 테스트 (EVENT-DRIVEN)

**WHEN** TelegramAdapter가 Telegram 업데이트를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 메시지 수신: Telegram Bot API 업데이트 파싱
- 메시지 발신: 응답 메시지 전송
- 폴링 관리: long polling 시작/중지

---

### 3.4 P2 에이전트/헬스 테스트 요구사항

#### REQ-P2-005: AgentRegistry 테스트 (EVENT-DRIVEN)

**WHEN** AgentRegistry가 에이전트 등록 요청을 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 등록/조회: 에이전트 등록, ID 기반 조회, 전체 목록 조회
- 중복 방지: 동일 ID 에이전트 중복 등록 거부
- 동적 관리: 런타임 에이전트 추가/제거

#### REQ-P2-006: P2PRouter 테스트 (EVENT-DRIVEN)

**WHEN** P2PRouter가 에이전트 간 메시지를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 라우팅: 대상 에이전트 식별 및 메시지 전달
- 응답 수집: 위임된 작업의 응답 수집 및 반환
- 실패 처리: 대상 에이전트 부재 시 에러 반환

#### REQ-P2-007: RalphLoop 테스트 (STATE-DRIVEN)

**IF** RalphLoop가 반복 실행 중인 상태이면 **THEN** 시스템은 다음을 검증해야 한다:

- 루프 진입/탈출: 반복 조건 충족/미충족 시 동작
- 반복 횟수 제한: 최대 반복 횟수 초과 시 강제 종료
- 결과 수렴: 연속 실행 결과 비교 및 수렴 판정

#### REQ-P2-008: Notifier 테스트 (EVENT-DRIVEN)

**WHEN** Notifier가 알림 이벤트를 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 알림 전송: 설정된 채널로 알림 발송
- 쿨다운: 중복 알림 방지를 위한 쿨다운 적용
- 형식: 알림 메시지 형식 및 내용 검증

#### REQ-P2-009: ProjectRegistry 테스트 (EVENT-DRIVEN)

**WHEN** ProjectRegistry가 프로젝트 등록 요청을 수신하면 **THEN** 시스템은 다음을 검증해야 한다:

- 프로젝트 등록/조회: CRUD 동작 검증
- 매칭 로직: 메시지 기반 프로젝트 매칭 알고리즘

---

### 3.5 품질 게이트 요구사항

#### REQ-QG-001: 커버리지 목표 (STATE-DRIVEN)

**IF** 각 Phase가 완료된 상태이면 **THEN** 시스템은 다음 커버리지 목표를 충족해야 한다:

| Phase | 완료 후 커버리지 | 추가 테스트 수 |
|-------|-----------------|---------------|
| Phase 1 (P1 핵심) | 35% | ~60개 |
| Phase 2 (P2 어댑터) | 50% | ~35개 |
| Phase 3 (P2 헬스) | 65% | ~65개 |
| Phase 4 (P3 + 통합) | 80% | ~60개 |

#### REQ-QG-002: 테스트 품질 (UBIQUITOUS)

시스템은 **항상** 다음 테스트 품질 기준을 충족해야 한다:

- 각 테스트는 독립적으로 실행 가능해야 한다
- 테스트 간 상태 공유가 없어야 한다
- 외부 의존성은 모두 mock 처리되어야 한다
- 비동기 테스트는 적절한 타임아웃을 포함해야 한다

#### REQ-QG-003: 금지 패턴 (UNWANTED)

시스템은 다음을 **하지 않아야 한다**:

- 실제 외부 API를 호출하는 테스트 작성
- 실제 subprocess를 spawn하는 테스트 작성
- 테스트 간 전역 상태에 의존하는 패턴 사용
- 하드코딩된 타이밍에 의존하는 테스트 작성 (fake timers 사용)

---

## 4. Specifications (명세)

### 4.1 테스트 유틸리티 명세

#### fixtures.ts

```typescript
// src/__tests__/fixtures.ts
export function makeMessage(overrides?: Partial<ChannelMessage>): ChannelMessage;
export function makeProject(overrides?: Partial<Project>): Project;
export function makeAgent(overrides?: Partial<AgentConfig>): AgentConfig;
export function makeAdapterConfig(type: string): AdapterConfig;
```

#### mock-adapters.ts

```typescript
// src/__tests__/mock-adapters.ts
export class MockAdapter extends AdapterBase {
  sentMessages: OutgoingMessage[];
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<void>;
}
```

#### test-helpers.ts

```typescript
// src/__tests__/test-helpers.ts
export function createMockLogger(): MockLogger;
export function flushPromises(): Promise<void>;
export function waitFor(fn: () => boolean, timeout?: number): Promise<void>;
```

### 4.2 테스트 파일 배치 명세

```
src/
  __tests__/
    fixtures.ts
    mock-adapters.ts
    test-helpers.ts
  adapters/
    __tests__/
      adapter-manager.test.ts
      slack-adapter.test.ts
      discord-adapter.test.ts
      webhook-adapter.test.ts
      telegram-adapter.test.ts
  agents/
    __tests__/
      executor.test.ts
      registry.test.ts
      p2p-router.test.ts
  health/
    __tests__/
      circuit-breaker.test.ts  (기존)
      daemon.test.ts
      ralph-loop.test.ts
      notifier.test.ts
      health-monitor.test.ts
  models/
    __tests__/
      model-router.test.ts  (기존)
      multi-stage.test.ts
  queue/
    __tests__/
      project-queue.test.ts  (기존)
  router/
    __tests__/
      project-router.test.ts
      registry.test.ts
```

### 4.3 Traceability (추적성)

| 요구사항 ID | 테스트 파일 | Phase |
|------------|------------|-------|
| REQ-INFRA-001~003 | `src/__tests__/fixtures.ts`, `mock-adapters.ts`, `test-helpers.ts` | 1 |
| REQ-P1-001 | `src/agents/__tests__/executor.test.ts` | 1 |
| REQ-P1-002 | `src/models/__tests__/multi-stage.test.ts` | 1 |
| REQ-P1-003 | `src/router/__tests__/project-router.test.ts` | 1 |
| REQ-P1-004 | `src/health/__tests__/daemon.test.ts` | 1 |
| REQ-P1-005 | `src/adapters/__tests__/adapter-manager.test.ts` | 1 |
| REQ-P2-001 | `src/adapters/__tests__/slack-adapter.test.ts` | 2 |
| REQ-P2-002 | `src/adapters/__tests__/discord-adapter.test.ts` | 2 |
| REQ-P2-003 | `src/adapters/__tests__/webhook-adapter.test.ts` | 2 |
| REQ-P2-004 | `src/adapters/__tests__/telegram-adapter.test.ts` | 2 |
| REQ-P2-005 | `src/agents/__tests__/registry.test.ts` | 3 |
| REQ-P2-006 | `src/agents/__tests__/p2p-router.test.ts` | 3 |
| REQ-P2-007 | `src/health/__tests__/ralph-loop.test.ts` | 3 |
| REQ-P2-008 | `src/health/__tests__/notifier.test.ts` | 3 |
| REQ-P2-009 | `src/router/__tests__/registry.test.ts` | 3 |
| REQ-QG-001~003 | 전체 테스트 스위트 | 4 |
