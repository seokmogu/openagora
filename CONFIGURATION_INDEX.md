# OpenAgora Configuration Index

Complete reference for all configuration files created for the OpenAgora multi-agent orchestration platform.

## File Structure

```
openagora/
├── config/
│   ├── channels.yaml          # Channel adapter configuration
│   ├── models.yaml            # AI model capabilities and assignments
│   └── mcp.json               # MCP server configuration
├── .env.example               # Environment variables template
├── docker-compose.yml         # Docker Compose services
├── Dockerfile                 # Multi-stage Docker build
├── openagora.service          # Systemd service unit
├── README.md                  # Comprehensive documentation
└── CONFIGURATION_INDEX.md     # This file
```

## 1. config/channels.yaml

Defines communication channels and their configuration.

**Channels:**
- **Slack**: Socket Mode with Bot Token and App Token
- **Discord**: Bot Token authentication
- **Telegram**: Bot Token authentication
- **Webhook**: JSON HTTP endpoint (port 3000)
- **CLI**: Local command-line interface

**Environment Variables Required:**
- `SLACK_BOT_TOKEN` (xoxb-...)
- `SLACK_APP_TOKEN` (xapp-...)
- `DISCORD_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `WEBHOOK_SECRET`

## 2. config/models.yaml

Specifies AI model capabilities and task assignments.

**Capability Categories:**
- `best-coding`: Claude (primary), Codex (review), Gemini (verify)
- `best-writing`: Claude Opus
- `best-research`: Perplexity (search), Claude Opus (synthesis)
- `best-image`: Midjourney (primary), DALL-E 3 (fallback)
- `best-analysis`: Gemini (primary), Claude Opus (fallback)
- `best-ui`: Vercel v0
- `best-planning`: Claude Opus

**Model Types:**
- **CLI Models**: claude, codex (local execution via command)
- **API Models**: gemini, perplexity, dalle3, v0 (remote API calls)

**Environment Variables Required:**
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `PERPLEXITY_API_KEY`
- `V0_API_KEY`

## 3. config/mcp.json

MCP (Model Context Protocol) server configuration for external tool integration.

**Configured Servers:**

| Server | Purpose | Environment Variable |
|--------|---------|----------------------|
| notion | Document management | NOTION_API_KEY |
| github | Repository access | GITHUB_TOKEN |
| sequential-thinking | Complex analysis | (none) |
| memory | Persistent knowledge | (none) |
| exa | Web search API | EXA_API_KEY |
| firecrawl | Web scraping | FIRECRAWL_API_KEY |
| playwright | Browser automation | (none) |
| context7 | API documentation | (none) |

## 4. .env.example

Template for all environment variables required by OpenAgora.

**Sections:**

1. **Claude Code**
   - `ANTHROPIC_API_KEY`: Anthropic API key

2. **Slack**
   - `SLACK_BOT_TOKEN`: xoxb- token
   - `SLACK_APP_TOKEN`: xapp- token

3. **Discord**
   - `DISCORD_BOT_TOKEN`: Bot token

4. **Telegram**
   - `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather

5. **Webhook**
   - `WEBHOOK_SECRET`: Authentication secret
   - `WEBHOOK_PORT`: Listening port (default: 3000)

6. **GitHub**
   - `GITHUB_TOKEN`: Personal access token
   - `GITHUB_USER`: GitHub username (default: seokmogu)

7. **AI Models**
   - `GEMINI_API_KEY`: Google Gemini API
   - `OPENAI_API_KEY`: OpenAI API (DALL-E, GPT)
   - `PERPLEXITY_API_KEY`: Perplexity research API
   - `V0_API_KEY`: Vercel v0 UI design

8. **Image Generation**
   - `MIDJOURNEY_API_KEY`: Midjourney API key

9. **External Tools (MCP)**
   - `NOTION_API_KEY`: Notion integration
   - `EXA_API_KEY`: Exa search API
   - `FIRECRAWL_API_KEY`: Firecrawl web scraper

10. **System**
    - `NODE_ENV`: production or development
    - `LOG_LEVEL`: debug, info, warn, error
    - `BASE_PROJECT_DIR`: ~/project (defaults to $HOME/project)
    - `HEALTH_PORT`: Health check port (default: 3001)

## 5. docker-compose.yml

Docker Compose configuration for production deployment.

**Services:**

### openagora
- **Image**: Built from Dockerfile
- **Restart**: unless-stopped
- **Network**: host (direct access)
- **Volumes**:
  - `$HOME/project` (project directory)
  - `$HOME/.claude` (Claude config, read-only)
  - `$HOME/bin` (utilities, read-only)
  - `./logs` (application logs)
  - `./registry` (runtime registry)
- **Environment**: Loaded from .env file

### health-check
- **Image**: curlimages/curl
- **Function**: Automated health monitoring
- **Interval**: 60 seconds
- **Endpoint**: http://localhost:3001/health

**Ports Exposed:**
- 3000: Webhook endpoint
- 3001: Health check and metrics

## 6. Dockerfile

Multi-stage Docker build for production image.

**Stage 1: Builder**
- Base: node:20-alpine
- Installs dependencies via `npm ci`
- Compiles TypeScript via `npm run build`

**Stage 2: Runtime**
- Base: node:20-alpine
- Installs: git, curl, bash, GitHub CLI
- Copies compiled dist and node_modules
- Copies config and registry directories
- Exposes ports 3000 and 3001

**Build Optimizations:**
- Alpine Linux for minimal image size
- Multi-stage to exclude build dependencies
- npm ci for reproducible installs
- GitHub CLI optional fallback installation

## 7. openagora.service

Systemd service unit for production deployment.

**Configuration:**
- **Type**: simple
- **User**: openagora
- **Working Directory**: /opt/openagora/app (configurable)
- **Environment File**: .env
- **Restart Policy**: always with 5-second interval
- **Logging**: to system journal (journalctl)

**Installation:**
```bash
sudo cp openagora.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openagora
sudo systemctl start openagora
```

**Monitoring:**
```bash
sudo systemctl status openagora
sudo journalctl -u openagora -f
```

## 8. README.md

Comprehensive documentation covering:

**Sections:**
1. Quick Start (3 steps: clone, configure, install)
2. Architecture Overview (ASCII diagram)
3. Channel Setup (step-by-step for each channel)
4. Project Management Commands
5. Configuration Files Reference
6. Development Guide
7. Deployment Options
8. Monitoring
9. Environment Variables
10. Troubleshooting
11. Advanced Features (Ralph Loop, Multi-Model Verification, Dynamic Agents, Worktree Isolation)
12. Contributing Guidelines
13. Performance Tuning
14. API Reference
15. Support

## Setup Workflow

### Step 1: Prepare Environment
```bash
cp .env.example .env
# Edit .env and fill in all API keys
```

### Step 2: Local Development
```bash
npm install
npm run build
npm start
```

### Step 3: Docker Deployment
```bash
docker-compose up --build
docker-compose logs -f openagora
```

### Step 4: Systemd Service
```bash
sudo cp openagora.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openagora
```

### Step 5: Verify
```bash
# Check health
curl http://localhost:3001/health

# View logs
docker-compose logs openagora
# or
sudo journalctl -u openagora -f
```

## Integration Points

### Channels to Router
- Slack → normalize → queue
- Discord → normalize → queue
- Telegram → normalize → queue
- Webhook → validate secret → queue
- CLI → direct → queue

### Router to Agents
- Project registry lookup
- Auto-create missing projects
- Route to appropriate agent team

### Agents to Models
- Task classification
- Model selection based on capability
- Parallel model verification

### Models to External Tools (MCP)
- GitHub for code management
- Notion for documentation
- Exa/Firecrawl for research
- Sequential Thinking for analysis

## Version Compatibility

- **Node.js**: 20.x (Alpine)
- **Docker**: 20.x+
- **Docker Compose**: 3.9+
- **Systemd**: Any modern version

## Security Considerations

1. **Secrets Management**
   - Use `.env` for local development (never commit)
   - Use Docker secrets or systemd EnvironmentFile for production
   - Rotate API keys regularly

2. **Network Security**
   - Webhook requires secret header validation
   - All external APIs use HTTPS
   - Docker uses host network mode for direct access

3. **Access Control**
   - Slack/Discord/Telegram require channel permissions
   - GitHub token requires minimal scopes
   - API keys are environment-specific

## Maintenance

### Updating
```bash
# Pull latest code
git pull

# Rebuild and restart
npm run build
docker-compose down
docker-compose up --build
```

### Backup
```bash
# Backup registry and logs
tar -czf openagora-backup.tar.gz registry/ logs/
```

### Health Monitoring
```bash
# Check service status
docker-compose ps

# Monitor logs
docker-compose logs -f --tail=100 openagora

# Check metrics
curl http://localhost:3001/metrics
```

---

**Created**: March 2026
**Version**: 1.0.0
**Location**: https://github.com/seokmogu/openagora
