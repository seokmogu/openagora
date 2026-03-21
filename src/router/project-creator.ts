import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';
import type { Project, DomainType } from '../types/index.js';
import type { ProjectRegistry } from './registry.js';

const execFileAsync = promisify(execFile);

export class ProjectCreator {
  private readonly registry: ProjectRegistry;

  constructor(registry: ProjectRegistry) {
    this.registry = registry;
  }

  async create(params: {
    name: string;
    domain: DomainType;
    description: string;
    baseDir: string;
    githubUser: string;
  }): Promise<Project> {
    const id = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const projectPath = path.join(params.baseDir, id);

    logger.info('Creating project', { id, path: projectPath });

    // Create directory
    await fs.mkdir(projectPath, { recursive: true });

    // Git init
    const git = simpleGit(projectPath);
    await git.init();
    logger.debug('Git repo initialized', { path: projectPath });

    // Create initial CLAUDE.md
    const claudeMd = [
      `# ${params.name}`,
      '',
      `**Domain**: ${params.domain}`,
      `**Description**: ${params.description}`,
      '',
      '## Project Context',
      '',
      `This project was auto-created by OpenAgora on ${new Date().toISOString()}.`,
      '',
      '## Guidelines',
      '',
      '- All tasks are routed through the OpenAgora multi-agent system.',
      '- Use conventional commits for all changes.',
    ].join('\n');

    await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), claudeMd, 'utf-8');

    // Initial commit
    await git.add('CLAUDE.md');
    await git.commit(`chore: initialize project ${params.name}`);
    logger.debug('Initial commit created', { id });

    // Create GitHub repo
    try {
      await execFileAsync('gh', [
        'repo',
        'create',
        `${params.githubUser}/${id}`,
        '--private',
        '--source',
        projectPath,
        '--remote',
        'origin',
        '--push',
      ]);
      logger.info('GitHub repo created', { repo: `${params.githubUser}/${id}` });
    } catch (err) {
      logger.warn('GitHub repo creation failed (continuing without remote)', {
        id,
        error: err,
      });
    }

    // Register in registry
    const project = await this.registry.create({
      name: params.name,
      domain: params.domain,
      githubUser: params.githubUser,
    });

    // Patch path to the actual created path (registry.create uses a derived path)
    const updated = await this.registry.update(project.id, { path: projectPath });

    logger.info('Project created successfully', { id, path: projectPath });
    return updated;
  }
}
