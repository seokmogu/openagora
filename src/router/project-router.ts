import type { AppConfig } from '../config/loader.js';
import type { ChannelMessage, DomainType } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ProjectRegistry } from './registry.js';
import { ProjectCreator } from './project-creator.js';
import { ProjectQueue } from '../queue/project-queue.js';
import { AgentRegistry } from '../agents/registry.js';
import { AgentExecutor } from '../agents/executor.js';
import { ProcessWatcher } from '../health/process-watcher.js';

/** ProjectRouter: the central dispatch hub. */
export class ProjectRouter {
  private readonly projectRegistry: ProjectRegistry;
  private readonly agentRegistry: AgentRegistry;
  private readonly creator: ProjectCreator;
  private readonly queue: ProjectQueue;
  private readonly executor: AgentExecutor;

  private readonly baseDir: string;
  private readonly githubUser: string;

  constructor(private readonly config: AppConfig, processWatcher: ProcessWatcher) {
    this.projectRegistry = new ProjectRegistry(config.registry.projectsPath);
    this.agentRegistry = new AgentRegistry(process.cwd());
    this.creator = new ProjectCreator(this.projectRegistry);
    this.queue = new ProjectQueue();
    this.executor = new AgentExecutor(processWatcher);

    this.baseDir = process.env['BASE_PROJECT_DIR'] ?? '/home/hackit/project';
    this.githubUser = process.env['GITHUB_USER'] ?? 'unknown';
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
      // 1. Match or create project
      let project = await this.projectRegistry.matchProject(message.content);

      if (!project) {
        const domain = AgentExecutor.detectDomain(message.content);
        const name = this.extractProjectName(message.content) ?? this.generateProjectName(domain);

        await message.replyFn(
          `새 프로젝트를 생성합니다: **${name}** (도메인: ${domain})\n잠시 기다려 주세요...`,
        );

        project = await this.creator.create({
          name,
          domain,
          description: message.content.slice(0, 200),
          baseDir: this.baseDir,
          githubUser: this.githubUser,
        });

        await message.replyFn(
          `✓ 프로젝트 생성 완료: \`${project.id}\` → ${project.path}`,
        );
      }

      // 2. Get agent for domain
      const agentId = this.agentRegistry.getAgentForDomain(project.domain);

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
      await this.queue.enqueue(project.id, message, async () => {
        await message.replyFn(
          `🔄 **${agentId}** 에이전트가 작업을 시작합니다...`,
        );

        const result = await this.executor.run(
          {
            id: message.id,
            projectId: finalProject.id,
            message,
            priority: 0,
            enqueuedAt: new Date(),
            status: 'running',
          },
          agentId,
          finalProject.path,
        );

        if (result.success) {
          await message.replyFn(formatSuccess(agentId, result.output, result.durationMs));
        } else {
          await message.replyFn(formatError(agentId, result.output, result.durationMs));
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
