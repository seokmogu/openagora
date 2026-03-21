---
id: SPEC-TEST-001
version: "1.0.0"
status: draft
created: "2026-03-21"
updated: "2026-03-21"
author: hackit
priority: high
---

# SPEC-TEST-001: 인수 기준 - 테스트 커버리지 확장

## 1. 테스트 인프라 (REQ-INFRA-001~003)

### Scenario 1.1: 공유 fixture 함수 사용

```gherkin
Given 테스트 인프라 파일이 src/__tests__/ 디렉토리에 존재하고
When 테스트 파일에서 makeMessage() fixture 함수를 호출하면
Then 유효한 ChannelMessage 객체가 반환되고
And 모든 필수 필드(id, channel, content, timestamp)가 채워져 있다
```

### Scenario 1.2: Logger mock 표준 패턴 적용

```gherkin
Given 새로운 테스트 파일이 작성될 때
When logger 모듈을 mock 처리하면
Then vi.mock('../../utils/logger.js') 패턴이 사용되고
And info, warn, error, debug 메서드가 모두 vi.fn()으로 대체된다
```

### Scenario 1.3: MockAdapter 동작

```gherkin
Given MockAdapter 인스턴스가 생성되고
When connect(), sendMessage(), disconnect()를 순서대로 호출하면
Then sentMessages 배열에 전송된 메시지가 기록되고
And 호출 순서가 보존된다
```

### Scenario 1.4: 비동기 헬퍼 유틸리티

```gherkin
Given flushPromises 헬퍼가 호출되면
When 마이크로태스크 큐에 대기 중인 Promise가 있을 때
Then 모든 pending Promise가 resolve된다
```

---

## 2. P1 핵심 모듈 테스트 (REQ-P1-001~005)

### 2.1 AgentExecutor

#### Scenario 2.1.1: 정상 실행 경로

```gherkin
Given AgentExecutor 인스턴스가 생성되고
And child_process.spawn이 mock 처리되어 정상 종료(exit code 0)를 반환하도록 설정되면
When execute() 메서드가 에이전트 설정과 메시지로 호출되면
Then spawn이 올바른 인자로 호출되고
And 실행 결과가 성공 상태로 반환된다
```

#### Scenario 2.1.2: subprocess 실패 시 CircuitBreaker 연동

```gherkin
Given AgentExecutor에 CircuitBreaker가 연결되어 있고
And child_process.spawn이 비정상 종료(exit code 1)를 반환하도록 설정되면
When execute()가 여러 번 실패하면
Then CircuitBreaker가 OPEN 상태로 전환되고
And 이후 실행 요청은 CircuitBreaker에 의해 즉시 거부된다
```

#### Scenario 2.1.3: 실행 타임아웃

```gherkin
Given AgentExecutor에 타임아웃이 30초로 설정되고
And vi.useFakeTimers()가 활성화되고
When execute()가 호출된 후 30초가 경과하면 (vi.advanceTimersByTime)
Then 프로세스가 SIGTERM으로 종료되고
And 타임아웃 에러가 반환된다
```

#### Scenario 2.1.4: 동시 실행 제한

```gherkin
Given AgentExecutor의 동시 실행 제한이 3으로 설정되고
When 5개의 실행 요청이 동시에 제출되면
Then 최대 3개만 동시에 실행되고
And 나머지 2개는 큐에서 대기한다
```

### 2.2 MultiStageOrchestrator

#### Scenario 2.2.1: 3단계 파이프라인 정상 흐름

```gherkin
Given MultiStageOrchestrator 인스턴스가 생성되고
And 각 단계(분석, 처리, 응답)의 핸들러가 설정되면
When 메시지가 오케스트레이터에 전달되면
Then 3단계가 순서대로 실행되고
And 각 단계의 출력이 다음 단계의 입력으로 전달되고
And 최종 응답이 반환된다
```

#### Scenario 2.2.2: 중간 단계 실패 시 에러 전파

```gherkin
Given MultiStageOrchestrator의 2단계(처리)가 에러를 throw하도록 설정되면
When 메시지가 오케스트레이터에 전달되면
Then 3단계(응답)는 실행되지 않고
And 에러가 호출자에게 전파된다
```

#### Scenario 2.2.3: P2P 위임 동작

```gherkin
Given MultiStageOrchestrator에 P2P 위임 설정이 활성화되고
And 대상 에이전트가 등록되어 있으면
When 위임 조건을 충족하는 메시지가 전달되면
Then P2PRouter를 통해 대상 에이전트로 작업이 위임되고
And 위임된 에이전트의 응답이 반환된다
```

### 2.3 ProjectRouter

#### Scenario 2.3.1: 프로젝트 매칭 성공

```gherkin
Given ProjectRouter에 2개의 프로젝트가 등록되어 있고
When 특정 프로젝트 키워드를 포함한 메시지가 전달되면
Then 올바른 프로젝트로 라우팅되고
And 해당 프로젝트의 에이전트가 실행된다
```

#### Scenario 2.3.2: 프로젝트 매칭 실패 (fallback)

```gherkin
Given ProjectRouter에 등록된 프로젝트가 있고
When 어떤 프로젝트와도 매칭되지 않는 메시지가 전달되면
Then 기본 fallback 동작이 실행되고
And 에러가 발생하지 않는다
```

### 2.4 HealthDaemon

#### Scenario 2.4.1: 주기적 헬스 체크 실행

```gherkin
Given HealthDaemon이 30초 간격으로 헬스 체크를 수행하도록 설정되고
And vi.useFakeTimers()가 활성화되면
When vi.advanceTimersByTime(90000)으로 90초를 전진하면
Then 헬스 체크가 정확히 3번 실행된다
```

#### Scenario 2.4.2: 데몬 정상 종료

```gherkin
Given HealthDaemon이 실행 중이고
When stop() 메서드가 호출되면
Then 타이머가 정리되고
And HTTP 서버가 종료되고
And 리소스 누수가 발생하지 않는다
```

### 2.5 AdapterManager

#### Scenario 2.5.1: 어댑터 동적 등록

```gherkin
Given AdapterManager 인스턴스가 생성되고
When MockAdapter를 register() 메서드로 등록하면
Then 등록된 어댑터 목록에 MockAdapter가 포함되고
And 어댑터의 connect()가 호출된다
```

#### Scenario 2.5.2: 메시지 라우팅

```gherkin
Given AdapterManager에 2개의 MockAdapter가 등록되어 있고
When 특정 채널의 메시지 전송이 요청되면
Then 해당 채널을 담당하는 어댑터로만 메시지가 전달된다
```

---

## 3. P2 어댑터 테스트 (REQ-P2-001~004)

### 3.1 SlackAdapter

#### Scenario 3.1.1: Slack 메시지 수신 및 변환

```gherkin
Given SlackAdapter가 초기화되고
And Slack WebClient가 mock 처리되면
When Slack 메시지 이벤트가 수신되면
Then 이벤트가 ChannelMessage 형식으로 변환되고
And channel, user, text 필드가 올바르게 매핑된다
```

#### Scenario 3.1.2: Slack API 에러 처리

```gherkin
Given SlackAdapter의 WebClient mock이 API 에러를 throw하도록 설정되면
When 메시지 발신을 시도하면
Then 에러가 적절히 로깅되고
And 어댑터가 크래시하지 않는다
```

### 3.2 WebhookAdapter

#### Scenario 3.2.1: 서명 검증 성공

```gherkin
Given WebhookAdapter가 시크릿 키로 구성되고
When 유효한 HMAC 서명이 포함된 webhook 요청이 수신되면
Then 요청이 수락되고
And 페이로드가 ChannelMessage로 변환된다
```

#### Scenario 3.2.2: 서명 검증 실패

```gherkin
Given WebhookAdapter가 시크릿 키로 구성되고
When 잘못된 서명이 포함된 webhook 요청이 수신되면
Then 요청이 거부되고
And 보안 경고가 로깅된다
```

---

## 4. 커버리지 게이트 (REQ-QG-001~003)

### Scenario 4.1: Phase 1 커버리지 달성

```gherkin
Given Phase 1의 모든 테스트가 작성 완료되고
When npx vitest run --coverage를 실행하면
Then 전체 라인 커버리지가 35% 이상이고
And P1 대상 모듈 각각의 커버리지가 60% 이상이다
```

### Scenario 4.2: Phase 4 최종 커버리지 달성

```gherkin
Given Phase 4의 모든 테스트가 작성 완료되고
When npx vitest run --coverage를 실행하면
Then 전체 라인 커버리지가 80% 이상이고
And 총 테스트 수가 220개 이상이다
```

### Scenario 4.3: 테스트 실행 시간

```gherkin
Given 전체 테스트 스위트가 실행될 때
When npx vitest run을 실행하면
Then 전체 실행 시간이 60초 이내이다
```

---

## 5. 엣지 케이스

### Scenario 5.1: 환경변수 미설정

```gherkin
Given API 키 환경변수가 설정되지 않은 상태에서
When 어댑터가 초기화를 시도하면
Then 명확한 에러 메시지와 함께 초기화가 실패하고
And 다른 어댑터의 동작에 영향을 주지 않는다
```

### Scenario 5.2: CircuitBreaker OPEN 상태에서 실행 요청

```gherkin
Given CircuitBreaker가 OPEN 상태이고
When AgentExecutor.execute()가 호출되면
Then subprocess가 spawn되지 않고
And CircuitBreakerOpenError가 즉시 반환된다
```

### Scenario 5.3: 네트워크 타임아웃

```gherkin
Given 어댑터의 외부 API 호출이 타임아웃되도록 mock 설정되고
And vi.useFakeTimers()가 활성화되면
When API 호출 후 타임아웃 시간이 경과하면
Then 타임아웃 에러가 발생하고
And 재시도 로직이 트리거된다 (설정된 경우)
```

### Scenario 5.4: 동시 메시지 처리 충돌

```gherkin
Given ProjectRouter가 동일 프로젝트에 대한 2개의 메시지를 동시에 수신하면
When 두 메시지가 병렬 처리되면
Then 각 메시지가 독립적으로 처리되고
And 상태 오염이 발생하지 않는다
```

### Scenario 5.5: HealthDaemon 헬스 체크 연속 실패

```gherkin
Given HealthDaemon의 헬스 체크가 3회 연속 실패하면
When 실패 임계값에 도달하면
Then Notifier를 통해 경고 알림이 발송되고
And 데몬이 복구 모드로 전환된다
```

---

## 6. Definition of Done (완료 정의)

- [ ] Phase별 모든 테스트가 `npx vitest run` 통과
- [ ] Phase별 커버리지 목표 달성 (35% -> 50% -> 65% -> 80%)
- [ ] 모든 테스트가 독립적으로 실행 가능 (격리 검증)
- [ ] 외부 API 호출 없음 (모든 외부 의존성 mock)
- [ ] 전체 테스트 스위트 실행 시간 60초 이내
- [ ] 공유 유틸리티(fixtures, helpers) 문서화
- [ ] 기존 3개 테스트 파일이 모두 통과 유지
