import { join } from 'node:path';
import type { AppConfig } from '../config/loader.js';
import type { ChannelMessage, DomainType } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ProjectRegistry } from './registry.js';
import { ProjectCreator } from './project-creator.js';
import { ProjectQueue } from '../queue/project-queue.js';
import { AgentRegistry } from '../agents/registry.js';
import { AgentExecutor } from '../agents/executor.js';
import { BuilderAgent } from '../agents/builder-agent.js';
import { MultiStageOrchestrator } from '../models/multi-stage.js';
import { P2PRouter } from '../agents/p2p-router.js';
import { ProcessWatcher } from '../health/process-watcher.js';
import { Notifier } from '../health/notifier.js';
import { CommandParser, HELP_MESSAGE } from './command-parser.js';

/** ProjectRouter: the central dispatch hub. */
export class ProjectRouter {
  private readonly projectRegistry: ProjectRegistry;
  private readonly agentRegistry: AgentRegistry;
  private readonly creator: ProjectCreator;
  private readonly queue: ProjectQueue;
  private readonly executor: AgentExecutor;
  private readonly p2pRouter: P2PRouter;
  private readonly orchestrator: MultiStageOrchestrator;
  private readonly commandParser: CommandParser;
  private notifier?: Notifier;

  private readonly baseDir: string;
  private readonly githubUser: string;

  constructor(private readonly config: AppConfig, processWatcher: ProcessWatcher) {
    this.projectRegistry = new ProjectRegistry(config.registry.projectsPath);
    this.agentRegistry = new AgentRegistry(process.cwd());
    this.creator = new ProjectCreator(this.projectRegistry);
    this.queue = new ProjectQueue();
    this.executor = new AgentExecutor(processWatcher);
    this.p2pRouter = new P2PRouter(this.executor, this.agentRegistry);
    this.orchestrator = new MultiStageOrchestrator(
      this.executor,
      join(process.cwd(), 'config'),
      this.p2pRouter,
    );

    this.commandParser = new CommandParser();
    this.baseDir = process.env['BASE_PROJECT_DIR'] ?? '/home/hackit/project';
    this.githubUser = process.env['GITHUB_USER'] ?? 'unknown';
  }

  setNotifier(n: Notifier): void {
    this.notifier = n;
  }

  async init(): Promise<void> {
    await this.projectRegistry.load();
    logger.info('Project router initialized', {
      registryPath: this.config.registry.projectsPath,
      baseDir: this.baseDir,
      githubUser: this.githubUser,
    });
  }

  /** Main entry point — called by every channel adapter. */
  async handleMessage(message: ChannelMessage): Promise<void> {
    logger.info('ProjectRouter: handling message', {
      id: message.id,
      channel: message.channel,
      userId: message.userId,
    });

    try {
      // 0. Parse command
      const parseResult = this.commandParser.parse(message.content, message.channel);

      if (!parseResult.ok) {
        await message.replyFn(
          `❌ ${parseResult.error.error}\n💡 ${parseResult.error.suggestion}`,
        );
        return;
      }

      const { command } = parseResult;

      // Branch on verb
      if (command.verb === 'chat') {
        await this.handleChat(command.taskDescription ?? '', message);
        return;
      }

      if (command.verb === 'help') {
        await message.replyFn(HELP_MESSAGE);
        return;
      }

      if (command.verb === 'list') {
        const active = this.getActiveProjects();
        if (active.length === 0) {
          await message.replyFn('활성 프로젝트가 없습니다.');
        } else {
          await message.replyFn(`활성 프로젝트 (${active.length}개):\n${active.map((p) => `• ${p}`).join('\n')}`);
        }
        return;
      }

      if (command.verb === 'status') {
        const stats = this.getQueueStats();
        if (command.projectName) {
          const stat = stats[command.projectName];
          if (!stat) {
            await message.replyFn(`프로젝트 **${command.projectName}**을(를) 찾을 수 없습니다.`);
          } else {
            await message.replyFn(
              `📊 **${command.projectName}** 상태\n• 대기 중: ${stat.pending}개\n• 큐 크기: ${stat.size}개`,
            );
          }
        } else {
          const entries = Object.entries(stats);
          if (entries.length === 0) {
            await message.replyFn('현재 활성 큐가 없습니다.');
          } else {
            const lines = entries.map(([name, s]) => `• **${name}**: 대기 ${s.pending}개 / 큐 ${s.size}개`);
            await message.replyFn(`📊 전체 큐 상태:\n${lines.join('\n')}`);
          }
        }
        return;
      }

      // verb === 'run' — existing flow
      const taskContent = command.taskDescription ?? message.content;

      // 1. Match or create project
      let project = command.projectName
        ? await this.projectRegistry.matchProject(command.projectName)
        : await this.projectRegistry.matchProject(taskContent);

      if (!project) {
        const domain = AgentExecutor.detectDomain(taskContent);
        const name = command.projectName ?? this.extractProjectName(taskContent) ?? this.generateProjectName(domain);

        await message.replyFn(
          `새 프로젝트를 생성합니다: **${name}** (도메인: ${domain})\n잠시 기다려 주세요...`,
        );

        project = await this.creator.create({
          name,
          domain,
          description: taskContent.slice(0, 200),
          baseDir: this.baseDir,
          githubUser: this.githubUser,
        });

        await message.replyFn(
          `✓ 프로젝트 생성 완료: \`${project.id}\` → ${project.path}`,
        );
      }

      // 2. Get agent for domain
      let agentId = this.agentRegistry.getAgentForDomain(project.domain);

      // 2a. If domain is 'general' and content is substantial, try BuilderAgent
      if (project.domain === 'general' && taskContent.length > 100) {
        const novelDomain = extractNovelDomain(taskContent);
        try {
          const builder = new BuilderAgent(process.cwd(), this.agentRegistry);
          const buildResult = await builder.create({
            domain: novelDomain,
            name: `${novelDomain.charAt(0).toUpperCase()}${novelDomain.slice(1)} Expert`,
            description: `Specialized agent for ${novelDomain} tasks`,
            responsibilities: [`Handle ${novelDomain} domain requests`, 'Produce structured outputs', 'Apply domain expertise'],
            capabilities: [`${novelDomain}-expertise`, 'domain-analysis', 'structured-output'],
            tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          });
          agentId = buildResult.agentId;
          logger.info('ProjectRouter: BuilderAgent created specialized agent', { novelDomain, agentId });
        } catch (builderErr) {
          const msg = builderErr instanceof Error ? builderErr.message : String(builderErr);
          logger.warn('ProjectRouter: BuilderAgent failed, falling back to expert-developer', { err: msg });
          agentId = 'expert-developer';
        }
      }

      logger.info('ProjectRouter: routing task', {
        projectId: project.id,
        domain: project.domain,
        agentId,
        queueDepth: this.queue.getDepth(project.id),
      });

      const queueDepth = this.queue.getDepth(project.id);
      if (queueDepth > 0) {
        await message.replyFn(
          `⏳ 프로젝트 **${project.name}**에 ${queueDepth}개 작업이 대기 중입니다. 순서대로 처리합니다.`,
        );
      }

      // 3. Enqueue — concurrency=1 per project (P1 solution)
      const finalProject = project;
      const finalDomain = project.domain;
      // Synthetic message with parsed task content so orchestrator receives clean task
      const taskMessage: ChannelMessage = { ...message, content: taskContent };
      await this.queue.enqueue(project.id, taskMessage, async () => {
        await message.replyFn(
          `🔄 **${agentId}** 에이전트가 작업을 시작합니다...`,
        );

        const task = {
          id: message.id,
          projectId: finalProject.id,
          message: taskMessage,
          priority: 0,
          enqueuedAt: new Date(),
          status: 'running' as const,
        };

        const result = await this.orchestrator.run(task, agentId, finalProject.path, finalDomain);

        if (result.success) {
          await message.replyFn(formatSuccess(agentId, result.summary, result.durationMs));
          void this.notifier?.send({ title: 'Task completed', body: result.summary.slice(0, 300), level: 'success', projectId: finalProject.id, agentId, durationMs: result.durationMs });
        } else {
          await message.replyFn(formatError(agentId, result.primary.output, result.durationMs));
          void this.notifier?.send({ title: 'Task failed', body: result.primary.output.slice(0, 200), level: 'error', projectId: finalProject.id, agentId, durationMs: result.durationMs });
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ProjectRouter: unhandled error', { messageId: message.id, err: msg });
      try {
        await message.replyFn(`❌ 오류가 발생했습니다: ${msg}`);
      } catch {
        // ignore reply failure
      }
    }
  }

  /** Handle casual chat without spawning an agent — call claude -p directly. */
  private async handleChat(content: string, message: ChannelMessage): Promise<void> {
    const { spawn } = await import('node:child_process');
    const prompt = `You are a helpful assistant integrated into Discord via OpenAgora. Reply concisely.\n\nUser: ${content}`;
    const reply = await new Promise<string>((resolve) => {
      let out = '';
      const child = spawn('claude', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.on('close', () => resolve(out.trim() || '죄송해요, 응답을 생성하지 못했습니다.'));
      child.on('error', () => resolve('죄송해요, Claude에 연결할 수 없습니다.'));
      setTimeout(() => { child.kill(); resolve('응답 시간이 초과됐습니다.'); }, 30000);
    });
    await message.replyFn(reply);
  }

  /** Extract an explicit project name from the message, if present. */
  private extractProjectName(content: string): string | undefined {
    const patterns = [
      /프로젝트\s+이름[:\s]+([^\s,!.?\n]+)/i,
      /project\s+name[:\s]+([^\s,!.?\n]+)/i,
      /프로젝트\s+([^\s,!.?\n]{2,30})/i,
      /project\s+([^\s,!.?\n]{2,30})/i,
    ];
    for (const p of patterns) {
      const m = p.exec(content);
      if (m?.[1]) return m[1].trim();
    }
    return undefined;
  }

  private generateProjectName(domain: DomainType): string {
    const suffix = Date.now().toString(36).slice(-5);
    return `${domain}-${suffix}`;
  }

  /** Expose queue stats for health monitoring. */
  getQueueStats(): Record<string, { size: number; pending: number }> {
    return this.queue.getStats();
  }

  getActiveProjects(): string[] {
    return this.queue.getActiveProjects();
  }

  async handleDiscoveredTask(task: import('../health/task-discovery.js').DiscoveredTask): Promise<void> {
    const project = await this.projectRegistry.get(task.projectId);
    if (!project) {
      logger.warn('ProjectRouter: discovered task for unknown project', { projectId: task.projectId });
      return;
    }

    const syntheticMessage: ChannelMessage = {
      id: `discovery-${Date.now()}`,
      channel: 'cli',
      channelId: 'discovery',
      userId: 'system',
      content: task.content,
      timestamp: new Date(),
      replyFn: async (reply) => {
        logger.info('TaskDiscovery reply', { projectId: task.projectId, reply: reply.slice(0, 200) });
      },
    };

    await this.handleMessage(syntheticMessage);
  }
}

/** Extract a potential novel domain name from message content. */
function extractNovelDomain(content: string): string {
  const lower = content.toLowerCase();
  const domainKeywords = [
    'blockchain', 'crypto', 'defi', 'nft',
    'legal', 'law', 'contract',
    'medical', 'health', 'clinical',
    'finance', 'trading', 'investment',
    'marketing', 'seo', 'advertising',
    'education', 'teaching', 'learning',
    'logistics', 'supply', 'inventory',
    'security', 'cybersecurity', 'infosec',
    'gaming', 'game', 'unity',
    'ai', 'machine learning', 'ml',
    'devops', 'infrastructure', 'cloud',
    'design', 'ui', 'ux',
    'mobile', 'ios', 'android',
  ];

  for (const keyword of domainKeywords) {
    if (lower.includes(keyword)) {
      // Normalize multi-word keywords to single identifier
      return keyword.replace(/\s+/g, '-');
    }
  }

  return 'specialist';
}

function formatSuccess(agentId: string, output: string, durationMs: number): string {
  const secs = (durationMs / 1000).toFixed(1);
  const preview = output.length > 1500 ? `${output.slice(0, 1500)}\n\n_(출력 일부 생략)_` : output;
  return `✅ **${agentId}** 완료 (${secs}s)\n\n${preview}`;
}

function formatError(agentId: string, error: string, durationMs: number): string {
  const secs = (durationMs / 1000).toFixed(1);
  return `❌ **${agentId}** 실패 (${secs}s)\n\n\`\`\`\n${error.slice(0, 500)}\n\`\`\``;
}
