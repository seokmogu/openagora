import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDefinition, DomainType } from '../types/index.js';
import { logger } from '../utils/logger.js';

const DOMAIN_TO_AGENT: Record<DomainType, string> = {
  planning: 'expert-planner',
  development: 'expert-developer',
  database: 'expert-dba',
  analysis: 'expert-analyst',
  research: 'expert-researcher',
  writing: 'expert-writer',
  general: 'expert-developer',
};

interface AgentRegistryEntry {
  id: string;
  name: string;
  domain: DomainType;
  dynamic: boolean;
  definitionPath: string;
  createdAt: string;
  createdBy?: string;
  capabilities: string[];
}

export class AgentRegistry {
  private readonly registryPath: string;
  private entries: AgentRegistryEntry[] = [];

  constructor(private readonly rootDir: string) {
    this.registryPath = join(rootDir, 'registry', 'agents.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.registryPath)) {
      this.entries = this.getBuiltinEntries();
      this.persist();
      return;
    }

    try {
      const raw = readFileSync(this.registryPath, 'utf-8');
      this.entries = JSON.parse(raw) as AgentRegistryEntry[];
    } catch (err) {
      logger.warn('Failed to read agents.json, re-initializing', { err });
      this.entries = this.getBuiltinEntries();
      this.persist();
    }
  }

  private getBuiltinEntries(): AgentRegistryEntry[] {
    const builtins: Array<{ id: string; name: string; domain: DomainType; capabilities: string[] }> = [
      {
        id: 'expert-planner',
        name: 'Planner Expert',
        domain: 'planning',
        capabilities: ['task-breakdown', 'roadmap', 'requirements-analysis', 'risk-assessment'],
      },
      {
        id: 'expert-developer',
        name: 'Developer Expert',
        domain: 'development',
        capabilities: ['feature-implementation', 'bug-fix', 'code-review', 'testing'],
      },
      {
        id: 'expert-dba',
        name: 'Database Expert',
        domain: 'database',
        capabilities: ['schema-design', 'query-optimization', 'migration', 'data-modeling'],
      },
      {
        id: 'expert-analyst',
        name: 'Analyst Expert',
        domain: 'analysis',
        capabilities: ['data-exploration', 'statistical-analysis', 'reporting', 'visualization'],
      },
      {
        id: 'expert-researcher',
        name: 'Researcher Expert',
        domain: 'research',
        capabilities: ['literature-review', 'competitive-analysis', 'fact-checking', 'synthesis'],
      },
      {
        id: 'expert-writer',
        name: 'Writer Expert',
        domain: 'writing',
        capabilities: ['academic-writing', 'technical-docs', 'blog-posts', 'reports'],
      },
      {
        id: 'builder-agent',
        name: 'Builder Agent',
        domain: 'general',
        capabilities: ['create-agent', 'agent-registry'],
      },
    ];

    return builtins.map((b) => ({
      ...b,
      dynamic: false,
      definitionPath: `.claude/agents/${b.id.replace('expert-', '')}.md`,
      createdAt: new Date().toISOString(),
    }));
  }

  private persist(): void {
    const dir = join(this.rootDir, 'registry');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(this.entries, null, 2));
  }

  /** Get agent id for a domain. */
  getAgentForDomain(domain: DomainType): string {
    // Check dynamic agents first (more specific)
    const dynamic = this.entries.find((e) => e.dynamic && e.domain === domain);
    if (dynamic) return dynamic.id;

    return DOMAIN_TO_AGENT[domain] ?? 'expert-developer';
  }

  /** Get all agent definitions. */
  getAllAgents(): AgentDefinition[] {
    return this.entries.map((e) => ({
      id: e.id,
      name: e.name,
      domain: e.domain,
      model: 'claude', // CLI default
      capabilities: e.capabilities,
      createdAt: new Date(e.createdAt),
      dynamic: e.dynamic,
    }));
  }

  /** Register a new dynamic agent. */
  register(entry: Omit<AgentRegistryEntry, 'createdAt'>): void {
    const existing = this.entries.find((e) => e.id === entry.id);
    if (existing) {
      logger.warn('Agent already registered, skipping', { id: entry.id });
      return;
    }

    this.entries.push({ ...entry, createdAt: new Date().toISOString() });
    this.persist();
    logger.info('Agent registered', { id: entry.id, domain: entry.domain, dynamic: entry.dynamic });
  }

  /** Check if an agent exists by id. */
  has(agentId: string): boolean {
    return this.entries.some((e) => e.id === agentId);
  }

  /** Get definition path for an agent. */
  getDefinitionPath(agentId: string): string | undefined {
    return this.entries.find((e) => e.id === agentId)?.definitionPath;
  }
}
