import { join } from 'node:path';
import type { AppConfig } from '../config/loader.js';
import { defaultBaseDir } from '../utils/platform.js';
import type { ChannelMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { ProjectRegistry } from './registry.js';
import { ProjectCreator } from './project-creator.js';
import { ProjectQueue } from '../queue/project-queue.js';
import { ClaudeCliBridge } from '../bridge/claude-cli-bridge.js';
import type { ProgressCallback } from '../bridge/claude-cli-bridge.js';
import { ProcessWatcher } from '../health/process-watcher.js';
import { Notifier } from '../health/notifier.js';
import { CommandParser, HELP_MESSAGE } from './command-parser.js';
import { SlackAdapter } from '../adapters/slack.js';
import { toSlackMarkdown, truncateForSlack } from '../utils/slack-format.js';

async function slackReact(message: ChannelMessage, emoji: string): Promise<void> {
  if (message.channel !== 'slack') return;
  const ts = (message.metadata as Record<string, string>)?.ts;
  const channelId = (message.metadata as Record<string, string>)?.channelId;
  if (ts && channelId) {
    await SlackAdapter.addReaction(channelId, ts, emoji);
  }
}

async function slackUnreact(message: ChannelMessage, emoji: string): Promise<void> {
  if (message.channel !== 'slack') return;
  const ts = (message.metadata as Record<string, string>)?.ts;
  const channelId = (message.metadata as Record<string, string>)?.channelId;
  if (ts && channelId) {
    await SlackAdapter.removeReaction(channelId, ts, emoji);
  }
}

/** ProjectRouter: the central dispatch hub. */
export class ProjectRouter {
  private readonly projectRegistry: ProjectRegistry;
  private readonly creator: ProjectCreator;
  private readonly queue: ProjectQueue;
  private readonly bridge: ClaudeCliBridge;
  private readonly commandParser: CommandParser;
  private notifier?: Notifier;

  // Map key: `${channel}:${userId}` → pending run command
  private readonly pendingConfirmations = new Map<string, {
    projectName: string | null;
    taskDescription: string;
    proposedCommand: string;
  }>();

  private readonly baseDir: string;
  private readonly githubUser: string;

  constructor(private readonly config: AppConfig, processWatcher: ProcessWatcher) {
    this.projectRegistry = new ProjectRegistry(config.registry.projectsPath);
    this.creator = new ProjectCreator(this.projectRegistry);
    this.queue = new ProjectQueue();
    this.bridge = new ClaudeCliBridge(processWatcher);
    this.commandParser = new CommandParser();
    this.baseDir = process.env['BASE_PROJECT_DIR'] ?? defaultBaseDir();
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
      // Check if this message is a yes/no response to a pending confirmation
      const pendingKey = `${message.channel}:${message.userId}`;
      const pending = this.pendingConfirmations.get(pendingKey);
      if (pending) {
        const lower = message.content.trim().toLowerCase();
        const isYes = /^(yes|y|응|ㅇ|ㅇㅇ|네|ok|오케|실행|해줘)$/.test(lower);
        const isNo = /^(no|n|아니|ㄴ|ㄴㄴ|취소|cancel)$/.test(lower);
        if (isYes || isNo) {
          this.pendingConfirmations.delete(pendingKey);
          if (isNo) {
            await message.replyFn('취소됐습니다.');
            return;
          }
          // Execute as run command
          const syntheticContent = pending.projectName
            ? `run ${pending.projectName} "${pending.taskDescription}"`
            : `run ${pending.taskDescription}`;
          await this.handleMessage({ ...message, content: `!openagora ${syntheticContent}` });
          return;
        }
        // Not yes/no — clear pending and fall through to normal handling
        this.pendingConfirmations.delete(pendingKey);
      }

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
        // Skip empty or system messages
        if (!command.taskDescription?.trim()) return;

        // Direct execution — no confirmation needed
        const taskContent = command.taskDescription;

        // Use existing project if matched, otherwise run in a neutral workspace
        const project = await this.projectRegistry.matchProject(taskContent);
        const neutralDir = join(this.baseDir, '.agora-workspace');
        if (!project) {
          const { mkdirSync, existsSync } = await import('node:fs');
          if (!existsSync(neutralDir)) mkdirSync(neutralDir, { recursive: true });
        }
        const projectPath = project?.path ?? neutralDir;

        await message.replyFn(`*claude* 에이전트가 작업을 시작합니다...`);
        await slackReact(message, 'hourglass_flowing_sand');

        const projectId = project?.id ?? 'default';
        const taskMessage: ChannelMessage = { ...message, content: taskContent };

        const progressFn: ProgressCallback = (status: string) => {
          message.replyFn(`> ${toSlackMarkdown(status)}`).catch(() => {});
        };

        await this.queue.enqueue(projectId, taskMessage, async () => {
          const result = await this.bridge.run(projectPath, taskContent, message.id, progressFn);

          await slackUnreact(message, 'hourglass_flowing_sand');

          if (result.success) {
            await slackReact(message, 'white_check_mark');
            await message.replyFn(formatSuccess('claude', result.output, result.durationMs));
          } else {
            await slackReact(message, 'x');
            await message.replyFn(formatError('claude', result.output, result.durationMs));
          }
        });
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
        const name = command.projectName ?? this.extractProjectName(taskContent) ?? this.generateProjectName(taskContent);

        await message.replyFn(
          `새 프로젝트를 생성합니다: **${name}**\n잠시 기다려 주세요...`,
        );

        project = await this.creator.create({
          name,
          domain: 'general',
          description: taskContent.slice(0, 200),
          baseDir: this.baseDir,
          githubUser: this.githubUser,
        });

        await message.replyFn(
          `✓ 프로젝트 생성 완료: \`${project.id}\` → ${project.path}`,
        );
      }

      logger.info('ProjectRouter: routing task', {
        projectId: project.id,
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
      // Synthetic message with parsed task content so bridge receives clean task
      const taskMessage: ChannelMessage = { ...message, content: taskContent };
      await this.queue.enqueue(project.id, taskMessage, async () => {
        await message.replyFn(
          `🔄 **claude** 에이전트가 작업을 시작합니다...`,
        );

        const progressFn: ProgressCallback = (status: string) => {
          message.replyFn(`> ${toSlackMarkdown(status)}`).catch(() => {});
        };

        await slackReact(message, 'hourglass_flowing_sand');

        const result = await this.bridge.run(finalProject.path, taskContent, message.id, progressFn);

        await slackUnreact(message, 'hourglass_flowing_sand');

        if (result.success) {
          await slackReact(message, 'white_check_mark');
          await message.replyFn(formatSuccess('claude', result.output, result.durationMs));
          void this.notifier?.send({ title: 'Task completed', body: result.output.slice(0, 300), level: 'success', projectId: finalProject.id, agentId: 'claude', durationMs: result.durationMs });
        } else {
          await slackReact(message, 'x');
          await message.replyFn(formatError('claude', result.output, result.durationMs));
          void this.notifier?.send({ title: 'Task failed', body: result.output.slice(0, 200), level: 'error', projectId: finalProject.id, agentId: 'claude', durationMs: result.durationMs });
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

  /** Handle casual chat — use Claude to determine intent (task vs. chat). Kept for reference; no longer called. */
  // @ts-expect-error: intentionally retained for reference; direct execution path now bypasses this method
  private async _handleChatLegacy(content: string, message: ChannelMessage): Promise<void> {
    const { spawn } = await import('node:child_process');

    const intentPrompt = `You are an intent analyzer for a multi-agent orchestration bot called OpenAgora.
Analyze the user message and respond ONLY with valid JSON, no markdown, no explanation.

User message: "${content}"

If this is a task/work request (asking to build, implement, fix, create, analyze, write code, etc.):
{"type":"task","project":"<project name if mentioned, or null>","task":"<clean task description in Korean or English>","response":"<friendly confirmation message in Korean>"}

If this is casual chat (greeting, question, general conversation):
{"type":"chat","response":"<your reply in Korean>"}

Rules:
- project: extract project name if explicitly mentioned (e.g. "openagora 프로젝트", "myapp에서"), otherwise null
- task: concise description of what needs to be done
- Keep responses natural and friendly in Korean`;

    const intentJson = await new Promise<string>((resolve) => {
      let out = '';
      const child = spawn('claude', ['-p', intentPrompt], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.on('close', () => resolve(out.trim()));
      child.on('error', () => resolve('{"type":"chat","response":"죄송해요, 잠시 오류가 발생했습니다."}'));
      setTimeout(() => { child.kill(); resolve('{"type":"chat","response":"응답 시간이 초과됐습니다."}'); }, 30000);
    });

    let parsed: { type: string; project?: string | null; task?: string; response?: string };
    try {
      // Extract JSON from response (Claude might add extra text)
      const jsonMatch = intentJson.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? intentJson) as typeof parsed;
    } catch {
      // Fallback to plain chat
      parsed = { type: 'chat', response: intentJson };
    }

    if (parsed.type === 'task' && parsed.task) {
      const projectName = parsed.project ?? null;
      const taskDescription = parsed.task;
      const commandStr = projectName
        ? `!openagora run ${projectName} "${taskDescription}"`
        : `!openagora run <자동감지> "${taskDescription}"`;

      // Store pending confirmation
      const pendingKey = `${message.channel}:${message.userId}`;
      this.pendingConfirmations.set(pendingKey, { projectName, taskDescription, proposedCommand: commandStr });

      const confirmMsg = [
        parsed.response ?? '이런 작업을 요청하셨나요?',
        '',
        '```',
        commandStr,
        '```',
        '',
        '실행할까요? **yes** / **no**',
      ].join('\n');
      await message.replyFn(confirmMsg);
    } else {
      await message.replyFn(parsed.response ?? intentJson);
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

  private generateProjectName(taskDescription: string): string {
    // Derive a readable slug from the task description
    const slug = taskDescription
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .replace(/[^a-z0-9-]/g, '')  // strip non-ASCII after join
      .slice(0, 30)
      || 'project';
    const suffix = Date.now().toString(36).slice(-4);
    return `${slug}-${suffix}`;
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
  const converted = toSlackMarkdown(output);
  const preview = truncateForSlack(converted);
  return `*${agentId}* 완료 (${secs}s)\n\n${preview}`;
}

function formatError(agentId: string, error: string, durationMs: number): string {
  const secs = (durationMs / 1000).toFixed(1);
  const truncated = error.slice(0, 500);
  return `*${agentId}* 실패 (${secs}s)\n\n\`\`\`\n${truncated}\n\`\`\``;
}
