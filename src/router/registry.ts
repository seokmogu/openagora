import fs from 'node:fs/promises';
import { join } from 'node:path';
import { defaultBaseDir } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import type { Project, DomainType } from '../types/index.js';

interface RegistryFile {
  version: string;
  projects: Project[];
}

export class ProjectRegistry {
  private projects: Map<string, Project> = new Map();
  private readonly registryPath: string;

  constructor(registryPath: string) {
    this.registryPath = registryPath;
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      const data = JSON.parse(content) as RegistryFile;
      this.projects = new Map(
        data.projects.map((p) => [
          p.id,
          {
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          },
        ]),
      );
      logger.info('Registry loaded', { count: this.projects.size, path: this.registryPath });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn('Registry file not found, starting empty', { path: this.registryPath });
        this.projects = new Map();
        return;
      }
      throw err;
    }
  }

  async save(): Promise<void> {
    const data: RegistryFile = {
      version: '1.0',
      projects: Array.from(this.projects.values()),
    };
    await fs.writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
    logger.debug('Registry saved', { count: this.projects.size, path: this.registryPath });
  }

  async get(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }

  async getAll(): Promise<Project[]> {
    return Array.from(this.projects.values());
  }

  async getActive(): Promise<Project[]> {
    return Array.from(this.projects.values()).filter((p) => p.status === 'active');
  }

  async create(params: {
    name: string;
    domain: DomainType;
    githubUser: string;
  }): Promise<Project> {
    const id = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date();
    const project: Project = {
      id,
      name: params.name,
      path: join(process.env['BASE_PROJECT_DIR'] ?? defaultBaseDir(), id),
      githubRepo: `${params.githubUser}/${id}`,
      domain: params.domain,
      agents: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(id, project);
    await this.save();
    logger.info('Project registered', { id, name: params.name });
    return project;
  }

  async matchProject(content: string): Promise<Project | undefined> {
    const active = await this.getActive();
    // Search by explicit patterns first: "프로젝트 X", "project X", "#X"
    const patterns = [
      /프로젝트\s+([^\s,!.?]+)/i,
      /project\s+([^\s,!.?]+)/i,
      /#([^\s,!.?]+)/,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match) {
        const keyword = match[1].toLowerCase();
        const found = active.find(
          (p) => p.id === keyword || p.name.toLowerCase() === keyword,
        );
        if (found) return found;
      }
    }
    // Fallback: name substring match
    const lower = content.toLowerCase();
    return active.find((p) => lower.includes(p.name.toLowerCase()));
  }

  async update(id: string, updates: Partial<Project>): Promise<Project> {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    const updated: Project = { ...project, ...updates, id, updatedAt: new Date() };
    this.projects.set(id, updated);
    await this.save();
    logger.info('Project updated', { id });
    return updated;
  }

  async pause(id: string): Promise<void> {
    await this.update(id, { status: 'paused' });
    logger.info('Project paused', { id });
  }

  async resume(id: string): Promise<void> {
    await this.update(id, { status: 'active' });
    logger.info('Project resumed', { id });
  }
}
