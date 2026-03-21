import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainType } from '../types/index.js';
import { AgentRegistry } from './registry.js';
import { logger } from '../utils/logger.js';

/** Result of a dynamic agent creation. */
export interface BuildResult {
  agentId: string;
  definitionPath: string;
  capabilities: string[];
}

/**
 * BuilderAgent creates new agent definitions at runtime.
 * This is the TypeScript side — it generates the .md definition file
 * and registers the agent. The actual LLM side uses .claude/agents/builder.md.
 */
export class BuilderAgent {
  private readonly dynamicDir: string;

  constructor(
    rootDir: string,
    private readonly registry: AgentRegistry,
  ) {
    this.dynamicDir = join(rootDir, '.claude', 'agents', 'dynamic');
  }

  /** Create a new domain agent dynamically. */
  async create(spec: {
    domain: DomainType | string;
    name: string;
    description: string;
    responsibilities: string[];
    capabilities: string[];
    tools: string[];
  }): Promise<BuildResult> {
    const agentId = `expert-${spec.domain}`;

    if (this.registry.has(agentId)) {
      logger.info('BuilderAgent: agent already exists', { agentId });
      return {
        agentId,
        definitionPath: this.registry.getDefinitionPath(agentId) ?? '',
        capabilities: spec.capabilities,
      };
    }

    if (!existsSync(this.dynamicDir)) {
      mkdirSync(this.dynamicDir, { recursive: true });
    }

    const fileName = `${spec.domain}.md`;
    const definitionPath = join(this.dynamicDir, fileName);
    const content = this.generateDefinition(agentId, spec);

    writeFileSync(definitionPath, content, 'utf-8');

    this.registry.register({
      id: agentId,
      name: spec.name,
      domain: spec.domain as DomainType,
      dynamic: true,
      definitionPath: `.claude/agents/dynamic/${fileName}`,
      createdBy: 'builder-agent',
      capabilities: spec.capabilities,
    });

    logger.info('BuilderAgent: created new agent', { agentId, definitionPath });

    return {
      agentId,
      definitionPath,
      capabilities: spec.capabilities,
    };
  }

  private generateDefinition(
    agentId: string,
    spec: {
      domain: string;
      name: string;
      description: string;
      responsibilities: string[];
      capabilities: string[];
      tools: string[];
    },
  ): string {
    const toolList = spec.tools.join(', ');
    const responsibilityList = spec.responsibilities.map((r) => `- ${r}`).join('\n');
    const qualityChecks = spec.responsibilities.slice(0, 3).map((r) => `- [ ] ${r} completed`).join('\n');
    const displayName = spec.name.replace(/Expert$/i, '').trim();

    return `---
name: ${agentId}
description: ${spec.description}
tools: ${toolList}
---

# ${spec.name} Agent

You are a ${displayName.toLowerCase()} expert for the OpenAgora system.

## Responsibilities

${responsibilityList}

## Working Style

- Understand the full context before taking action
- Produce structured, well-documented outputs
- State assumptions and limitations explicitly

## Quality Gate

Before marking complete, verify:
${qualityChecks}
- [ ] Output is complete and actionable
`;
  }
}
