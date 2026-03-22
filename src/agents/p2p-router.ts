import type { ChannelMessage, DomainType } from '../types/index.js';
import type { AgentRegistry } from './registry.js';
import { AgentExecutor } from './executor.js';
import { logger } from '../utils/logger.js';

/** A parsed delegation request found in agent output. */
export interface DelegationRequest {
  to: string;       // target agentId (e.g. "expert-dba", "expert-writer")
  task: string;     // task description to forward
  domain?: DomainType;
}

/**
 * P2PRouter: parses DELEGATE blocks from agent output and executes them.
 *
 * Protocol: agents embed one or more blocks in their output:
 *   <!-- DELEGATE: {"to":"expert-dba","task":"Design users table schema"} -->
 *
 * Multiple delegations are executed sequentially (same project, ordered).
 */
export class P2PRouter {
  private static readonly DELEGATE_RE =
    /<!--\s*DELEGATE:\s*(\{[^}]+\})\s*-->/g;

  constructor(
    private readonly executor: AgentExecutor,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  /** Returns all delegation requests found in the text, or empty array. */
  static parse(output: string): DelegationRequest[] {
    const results: DelegationRequest[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(P2PRouter.DELEGATE_RE.source, 'g');
    while ((match = re.exec(output)) !== null) {
      try {
        const req = JSON.parse(match[1]) as DelegationRequest;
        if (req.to && req.task) results.push(req);
      } catch {
        logger.warn('P2PRouter: malformed DELEGATE block', { raw: match[1] });
      }
    }
    return results;
  }

  /**
   * Executes all delegations found in primaryOutput sequentially.
   * Returns concatenated outputs of all delegated tasks.
   */
  async route(
    delegations: DelegationRequest[],
    parentMessage: ChannelMessage,
    projectPath: string,
    parentTaskId: string,
  ): Promise<string[]> {
    const outputs: string[] = [];

    for (let i = 0; i < delegations.length; i++) {
      const d = delegations[i];
      const subTaskId = `${parentTaskId}-p2p-${i}`;

      // Resolve agentId: use specified 'to' if registered, else fall back
      const resolvedAgent = this.agentRegistry.isKnown(d.to) ? d.to : 'expert-developer';

      logger.info('P2PRouter: delegating', {
        from: parentTaskId,
        to: resolvedAgent,
        subTaskId,
      });

      const subTask = {
        id: subTaskId,
        projectId: subTaskId,
        priority: 0,
        enqueuedAt: new Date(),
        status: 'running' as const,
        message: {
          ...parentMessage,
          id: subTaskId,
          content: d.task,
        },
      };

      const result = await this.executor.run(subTask, resolvedAgent, projectPath);

      if (result.success) {
        outputs.push(`[${resolvedAgent}]: ${result.output}`);
      } else {
        logger.warn('P2PRouter: delegation failed', { subTaskId, resolvedAgent, err: result.output });
        outputs.push(`[${resolvedAgent}] (failed): ${result.output.slice(0, 200)}`);
      }
    }

    return outputs;
  }
}
