# SPEC-ONBOARD-001: Onboarding Flow Improvement

**Status**: Draft
**Created**: 2026-03-23
**Author**: seokmogu
**Priority**: P1

---

## 1. Problem Statement

New users cannot start using OpenAgora within 5 minutes of cloning. The current onboarding flow has 6 critical friction points that cause confusion and abandonment.

### Root Causes

| # | Problem | Evidence | Impact |
|---|---------|----------|--------|
| P1 | `ANTHROPIC_API_KEY` appears required but Claude CLI auth is sufficient | `tokens.ts:18` marks it `required: true`; README says "Essential (at minimum)" | Users think they need an API key when they already have Claude CLI authenticated |
| P2 | `.env.example` has no required/optional distinction | All 20+ env vars listed flat with no grouping or defaults | Users don't know what's mandatory vs optional |
| P3 | CLI-only mode not documented | No mention that OpenAgora works without any channel tokens | Users assume they need Slack/Discord tokens to even try it |
| P4 | Setup wizard UX is unclear | `setup.ts` iterates all adapters sequentially asking yes/no | No quick-start path, no "skip all and use CLI" option |
| P5 | No README quick-start for zero-config | Quick Start section requires API keys before `npm install` | Should be: clone, install, run CLI — 3 commands |
| P6 | `channels.yaml` enables all channels by default | All 5 channels set `enabled: true` | Server crashes or warns on startup when tokens are missing |

---

## 2. Requirements (EARS Format)

### REQ-1: Zero-Config CLI Quick Start

**When** a user clones the repository and has Claude CLI authenticated,
**the system shall** allow starting in CLI-only mode with `npm install && npm run build && npm start` without any `.env` file or configuration,
**so that** new users can execute their first task within 3 commands.

**Acceptance Criteria:**
- AC-1.1: Server starts successfully without `.env` file
- AC-1.2: CLI adapter is functional without any environment variables
- AC-1.3: Channels with missing tokens are automatically disabled (not crash)
- AC-1.4: Startup log clearly shows which adapters are active vs skipped

### REQ-2: Channel Auto-Detection

**When** the server starts,
**the system shall** detect which channel tokens are present in the environment and enable only those channels,
**so that** users don't need to manually edit `channels.yaml` or encounter errors for unconfigured channels.

**Acceptance Criteria:**
- AC-2.1: `channels.yaml` defaults all channels to `enabled: false` except CLI
- AC-2.2: Channel adapters check for required tokens before initialization
- AC-2.3: Missing tokens result in info-level log (not error) and graceful skip
- AC-2.4: Startup summary shows: "Active channels: CLI. Inactive: Slack (no token), Discord (no token)..."

### REQ-3: Updated Token Definitions

**When** the token system defines required vs optional tokens,
**the system shall** correctly mark `ANTHROPIC_API_KEY` as optional (Claude CLI auth is primary),
**so that** the setup wizard and documentation accurately reflect actual requirements.

**Acceptance Criteria:**
- AC-3.1: `ANTHROPIC_API_KEY` marked `required: false` in `tokens.ts` with description noting Claude CLI auth
- AC-3.2: All channel tokens marked as required only within their adapter context (not globally)
- AC-3.3: Token list command shows "Required for: Slack" instead of just "yes/no"

### REQ-4: Improved Setup Wizard

**When** a user runs `openagora setup`,
**the system shall** offer a guided experience with a quick-start option,
**so that** users can choose between minimal setup (CLI only) and full configuration.

**Acceptance Criteria:**
- AC-4.1: First question offers "Quick Start (CLI only)" vs "Full Setup"
- AC-4.2: Quick Start skips all token configuration and confirms readiness
- AC-4.3: Full Setup groups tokens by adapter with clear required/optional labels
- AC-4.4: After setup, display a "Next Steps" summary with the exact command to run

### REQ-5: README Quick Start Rewrite

**When** a user reads the README for the first time,
**the system shall** present a 3-command quick start that requires no prior configuration,
**so that** users can immediately try OpenAgora.

**Acceptance Criteria:**
- AC-5.1: Quick Start section shows: `git clone`, `npm install && npm run build`, `npm start`
- AC-5.2: "Prerequisites" section lists only: Node.js 20+, Claude CLI (authenticated)
- AC-5.3: Channel configuration is in a separate "Channel Setup" section below quick start
- AC-5.4: Remove "ANTHROPIC_API_KEY" from "Essential" list

### REQ-6: Startup Validation with Friendly Messages

**When** the server starts and detects configuration issues,
**the system shall** display actionable guidance instead of cryptic errors,
**so that** users know exactly what to fix.

**Acceptance Criteria:**
- AC-6.1: Missing `.env` file produces info message, not error (CLI mode works without it)
- AC-6.2: No `claude` CLI on PATH produces clear error: "Claude CLI not found. Install: https://..."
- AC-6.3: Startup banner shows version, active channels, and health endpoint URL
- AC-6.4: First-run detection: if no `.env` exists, suggest running `openagora setup`

---

## 3. Scope

### In Scope

| Area | Files | Changes |
|------|-------|---------|
| Token definitions | `src/cli/tokens.ts` | Update required flags and descriptions |
| Setup wizard | `src/cli/setup.ts` | Add quick-start path, improve UX |
| Channel config | `config/channels.yaml` | Default channels to `enabled: false` except CLI |
| Adapter manager | `src/adapters/manager.ts` | Auto-detect available tokens, graceful skip |
| Config loader | `src/config/loader.ts` | Handle missing `.env` gracefully |
| Entry point | `src/index.ts` | Add startup banner and validation |
| CLI entry | `src/cli/main.ts` | Update help text |
| README | `README.md` | Rewrite quick-start section |
| Env template | `.env.example` | Reorganize with required/optional sections |

### Out of Scope

- New channel adapter implementations
- Authentication system changes
- Docker/deployment improvements (separate SPEC)
- MCP server configuration

---

## 4. Technical Design

### 4.1 Channel Auto-Detection Flow

```
Server Start
  ├─ Load .env (or defaults if missing)
  ├─ For each channel in channels.yaml:
  │   ├─ Check if required tokens exist in process.env
  │   ├─ Token present? → Enable adapter
  │   └─ Token missing? → Skip with info log
  ├─ CLI adapter always enabled
  └─ Print startup summary
```

### 4.2 Startup Validation Order

1. Check Node.js version (>= 20)
2. Check `claude` CLI availability (`which claude`)
3. Load config (graceful if `.env` missing)
4. Auto-detect available channels
5. Print startup banner
6. Start enabled adapters only

### 4.3 Setup Wizard Flow

```
openagora setup
  ├─ "Welcome to OpenAgora!"
  ├─ Detect: Claude CLI authenticated? → Show status
  ├─ Question 1: Quick Start or Full Setup?
  │   ├─ Quick Start:
  │   │   └─ "Ready! Run: npm start"
  │   └─ Full Setup:
  │       ├─ For each adapter group:
  │       │   ├─ "Configure Slack? (optional)"
  │       │   └─ Collect tokens if yes
  │       └─ Show summary + next command
  └─ End
```

---

## 5. Test Plan

| Test | Type | Validates |
|------|------|-----------|
| Server starts without .env | Integration | REQ-1, AC-1.1 |
| CLI adapter works without tokens | Integration | REQ-1, AC-1.2 |
| Missing Slack token skips Slack adapter | Unit | REQ-2, AC-2.3 |
| Startup log shows active/inactive channels | Integration | REQ-2, AC-2.4 |
| ANTHROPIC_API_KEY marked optional | Unit | REQ-3, AC-3.1 |
| Setup wizard quick-start path | Unit | REQ-4, AC-4.1-4.2 |
| claude CLI not found shows clear error | Unit | REQ-6, AC-6.2 |
| Startup banner displays correctly | Integration | REQ-6, AC-6.3 |

---

## 6. Migration Notes

- `channels.yaml` change (enabled: true → false) is backward-incompatible for existing users with tokens in .env
- Mitigation: Auto-detection overrides yaml config, so existing users with tokens set will see no change in behavior
- `.env.example` reorganization is documentation-only change

---

Version: 1.0.0
