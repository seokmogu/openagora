# OpenAgora — System Specification

> Open multi-agent orchestration platform for planning, development, research, analysis, and academic writing.

---

## 1. 해결하는 문제

| # | 문제 | 증상 |
|---|------|------|
| P1 | 다채널 동시 요청 충돌 | Slack + Discord 동시 요청 시 에이전트 상태 경쟁 |
| P2 | 하트비트 좀비 | 실행 중인 에이전트와 하트비트가 충돌, 좀비 프로세스 |
| P3 | 하트비트 사이 작업 지속 충돌 | 작업이 heartbeat 간격을 넘어 계속될 때 중복 실행 |
| P4 | 병렬 프로젝트 코드 충돌 | 여러 프로젝트 동시 작업 시 파일/git 충돌 |
| P5 | 에이전트 고정 구조 | 필요한 도메인에 맞는 에이전트를 동적으로 추가 불가 |
| P6 | 24시간 자율 운영 불안정 | 스스로 문제 발견·해결하는 루프가 좀비로 끝남 |
| P7 | 단일 모델 의존 | Claude만 쓸 경우 검증 다양성 부족 |
| P8 | 외부 도구 통합 부재 | Notion, 웹검색, 이미지 생성 등 연동 없음 |

---

## 2. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHANNEL ADAPTER                               │
│  Slack / Discord / Telegram / Email / Webhook / CLI             │
│  → 채널별 정규화 → 프로젝트별 FIFO 큐 (P1 해결)                │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  PROJECT ROUTER                                   │
│  프로젝트 레지스트리 조회 → 해당 프로젝트 워크스페이스로 라우팅 │
│  없으면 신규 프로젝트 생성 (git repo 자동 생성)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│               AGENT ORCHESTRATION (moai-adk 기반)                │
│                                                                  │
│  ┌─ Manager Agents ────────────────────────────────────────┐    │
│  │  project / spec / strategy / git / docs / quality       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Expert Agents (동적 생성 가능) ────────────────────────┐    │
│  │  기본: backend / frontend / security / devops / testing  │    │
│  │  추가: planner / analyst / researcher / writer / dba    │    │
│  │  자동생성: Builder Agent가 필요 시 새 Expert 생성        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Builder Agents ────────────────────────────────────────┐    │
│  │  새 에이전트 / 스킬 / MCP 플러그인 동적 생성             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ Team Agents (P2P 대화) ────────────────────────────────┐    │
│  │  Git Worktree 격리 + SendMessage 직접 통신               │    │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   MULTI-MODEL ROUTER                             │
│                                                                  │
│  코드 구현    → Claude (Sonnet/Opus)                            │
│  코드 리뷰    → Codex (GPT, CLI)                               │
│  최종 검증    → Gemini (API)                                    │
│  이미지 생성  → DALL-E 3 / Midjourney / Flux                   │
│  UI 디자인    → v0 (Vercel)                                    │
│  리서치       → Perplexity API                                 │
│  글쓰기/논문  → Claude Opus                                    │
│  데이터 분석  → Gemini (long context) / GPT-4o Code Interpreter│
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                  HEALTH & LOOP ENGINE                            │
│                                                                  │
│  Ralph 루프: 스태그네이션 감지 (개선 없으면 자동 탈출)           │
│  Circuit Breaker: 5회 실패 → 자동 차단                          │
│  TeammateIdle Gate: LSP 오류 + 커버리지 충족 시만 완료 허용      │
│  3중 종료조건: max-runs + max-cost + max-duration                │
│  SIGKILL: 30초 무응답 → process group 강제 종료 (P2, P3 해결)  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 에이전트 시스템

### 3.1 동적 에이전트 생성 (P5 해결)

에이전트는 고정이 아님. Builder Agent가 필요 시 새 에이전트를 생성:

```
사용자: "블록체인 스마트컨트랙트 감사해줘"
  → 기존 에이전트 중 적합한 것 없음
  → Builder Agent 호출
  → expert-blockchain-auditor.md 생성
  → 즉시 해당 에이전트로 태스크 위임
```

생성된 에이전트는 `.claude/agents/moai/` 에 저장되고 git으로 관리됨.

### 3.2 도메인 에이전트 (기본 제공)

| 에이전트 | 도메인 | 모델 | 역할 |
|---------|--------|------|------|
| expert-planner | 기획 | Opus | PRD, 로드맵, 마일스톤, EARS 스펙 |
| expert-analyst | 분석 | Sonnet | 데이터 분석, 시각화, 인사이트 |
| expert-researcher | 연구 | Opus | 문헌 검색, 웹 리서치, 종합 보고 |
| expert-writer | 논문 | Opus | 학술 작성, 레퍼런스, 포매팅 |
| expert-dba | DB | Sonnet | 스키마 설계, 마이그레이션, 최적화 |
| expert-backend | 개발 | Sonnet | API, 서비스, 테스트 |

### 3.3 P2P 에이전트 통신

에이전트는 Orchestrator를 거치지 않고 직접 대화:

```
Developer → DBA: "이 스키마 설계해줘"
Researcher → Writer: "이 연구 결과 논문 형식으로 써줘"
Planner → Developer: "이 스펙 구현해줘"
```

---

## 4. 채널 어댑터 (P1 해결)

### 4.1 지원 채널

| 채널 | 방식 | 상태 |
|------|------|------|
| Slack | Bot API (Socket Mode) | 1차 |
| Discord | Bot API | 1차 |
| Telegram | Bot API | 1차 |
| Email | IMAP/SMTP | 2차 |
| Webhook | HTTP POST | 1차 |
| CLI | stdin | 1차 |
| Web UI | WebSocket | 2차 |

### 4.2 충돌 방지 (P1 해결)

```
모든 채널 → Channel Normalizer → Project Queue (FIFO per project)
                                  ↓
                          순차 처리 (single-writer per project)
                          다른 프로젝트는 병렬 처리
```

채널 추가는 플러그인 방식 — `adapters/` 디렉토리에 새 어댑터 파일 추가만으로 확장.

---

## 5. 프로젝트 관리

### 5.1 프로젝트 레지스트리

각 프로젝트는 독립된 Git 레포로 관리:

```
~/project/
  ├── openagora/          ← 관리 레포 (설정, 로그, 문서)
  ├── project-web-app/    ← 프로젝트 레포 (자동 생성)
  ├── project-research/   ← 프로젝트 레포 (자동 생성)
  └── project-paper/      ← 프로젝트 레포 (자동 생성)
```

레지스트리 (`openagora/registry/projects.json`):
```json
{
  "projects": [
    {
      "id": "web-app",
      "name": "My Web App",
      "path": "~/project/project-web-app",
      "github_repo": "seokmogu/project-web-app",
      "domain": "development",
      "agents": ["expert-backend", "expert-frontend", "expert-dba"],
      "status": "active"
    }
  ]
}
```

### 5.2 Git Worktree 격리 (P4 해결)

각 태스크는 독립 worktree에서 실행:

```
project-web-app/
  └── .trees/
      ├── task-auth-001/    ← 에이전트 A 작업 공간
      ├── task-api-002/     ← 에이전트 B 작업 공간
      └── task-db-003/      ← 에이전트 C 작업 공간
```

### 5.3 관리 레포 (openagora)

```
openagora/
  ├── SPEC.md              ← 이 파일
  ├── registry/
  │   ├── projects.json    ← 프로젝트 목록
  │   └── agents.json      ← 등록된 에이전트 목록
  ├── config/
  │   ├── channels.yaml    ← 채널 설정
  │   ├── models.yaml      ← 모델 라우팅 설정
  │   └── mcp.json         ← MCP 서버 설정
  ├── logs/
  │   ├── cycles/          ← 사이클 로그
  │   └── metrics/         ← 성능 메트릭
  ├── docs/
  │   ├── architecture.md  ← 아키텍처 문서
  │   └── runbooks/        ← 운영 가이드
  └── results/
      └── reports/         ← 생성된 보고서, 논문 등
```

---

## 6. 외부 도구 통합

### 6.1 MCP 서버

| MCP | 용도 | 도메인 |
|-----|------|--------|
| notion | 문서 관리, 지식베이스 | 전 도메인 |
| github | 레포 관리, PR, 이슈 | 개발 |
| sequential-thinking | 복잡한 추론 | 분석, 연구 |
| memory | 크로스세션 지식 | 전 도메인 |
| exa / perplexity | 웹 검색 | 연구, 기획 |
| firecrawl | 웹 크롤링 | 연구 |
| clickhouse | 대용량 분석 쿼리 | 분석, DB |
| context7 | 라이브러리 문서 | 개발 |
| playwright | 브라우저 자동화 | 테스트 |

### 6.2 외부 API

| API | 용도 |
|-----|------|
| Perplexity API | 인용 포함 리서치 |
| DALL-E 3 (OpenAI) | 이미지 생성 |
| Midjourney (Discord API) | 고품질 이미지 |
| v0 API (Vercel) | UI 컴포넌트 생성 |
| Gemini API | 검증, 분석, 긴 컨텍스트 |
| Codex CLI | 코드 리뷰 (ChatGPT Pro) |

---

## 7. 멀티모델 라우팅

### 7.1 태스크 타입별 라우팅

```yaml
routing:
  code_implement:   claude-sonnet
  code_review:      codex-cli        # ChatGPT Pro
  code_verify:      gemini-api
  planning:         claude-opus
  research:         perplexity + claude-opus (synthesis)
  writing:          claude-opus
  image_generate:   dalle3 or midjourney
  ui_design:        v0
  data_analysis:    gemini-api or gpt4o-code-interpreter
  translation:      claude-sonnet
```

### 7.2 검증 파이프라인

```
구현 (Claude)
  → 리뷰 (Codex) — 다른 시각으로 검토
  → 검증 (Gemini) — 테스트, 품질 게이트
  → PASS: 머지 / FAIL: Claude에게 피드백
```

---

## 8. 24시간 자율 운영 (P2, P3, P6 해결)

### 8.1 헬스 모니터

```
Daemon (10분):   전체 시스템 상태 체크
  └─ Patrol:     프로젝트별 에이전트 상태
       └─ Witness: 30분 무응답 → SIGKILL(-pid)
```

### 8.2 Ralph 루프 (스태그네이션 감지)

```
이전 Feedback == 현재 Feedback → 자동 수렴 종료 (무한 재시도 방지)
Circuit Breaker: 5회 연속 실패 → 차단 + 알림
3중 종료조건: max-runs=100 + max-cost=$10 + max-duration=2h
```

### 8.3 GUPP 원칙

에이전트 시작 시 큐 즉시 확인 → 작업 있으면 바로 실행 (대기 없음)

### 8.4 자율 태스크 발견

```
코드베이스 분석 → 개선점 발견 → 백로그에 자동 추가
실패 패턴 학습 → 유사 태스크 선제 처리
목표(goals.md) 기반 → 자동 태스크 생성
```

---

## 9. 품질 게이트 (TRUST 5)

| 차원 | 기준 |
|------|------|
| Tested | 커버리지 85%+ |
| Readable | lint 오류 0 |
| Unified | 포매팅 일관성 |
| Secured | OWASP 준수 |
| Trackable | conventional commits |

---

## 10. 구현 단계

### Phase 1 — 핵심 인프라 (1주)
- [ ] Channel Adapter (Slack + Discord + Webhook + CLI)
- [ ] Project Router + Registry
- [ ] Project 생성 자동화 (git repo 자동 생성)
- [ ] Health Monitor (Daemon + Circuit Breaker + SIGKILL)

### Phase 2 — 에이전트 시스템 (1주)
- [ ] 6개 도메인 Expert 에이전트 정의
- [ ] Builder Agent (동적 에이전트 생성)
- [ ] P2P 에이전트 통신
- [ ] Git Worktree 격리 자동화

### Phase 3 — 멀티모델 (1주)
- [ ] 모델 라우터
- [ ] Codex CLI 통합
- [ ] Gemini API 통합
- [ ] 이미지 생성 (DALL-E 3)

### Phase 4 — 외부 도구 (1주)
- [ ] MCP 서버 설정 (Notion, GitHub, Perplexity, etc.)
- [ ] Telegram 채널 어댑터
- [ ] Webhook 어댑터
- [ ] 관리 UI (선택)

### Phase 5 — 자율 운영 (1주)
- [ ] Ralph 루프 + 스태그네이션 감지
- [ ] 24/7 데몬 (systemd)
- [ ] 자율 태스크 발견
- [ ] 알림 시스템 (Slack/Telegram)
