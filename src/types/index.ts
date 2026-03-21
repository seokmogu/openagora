export type ChannelType = 'slack' | 'discord' | 'telegram' | 'email' | 'webhook' | 'cli';

export type DomainType = 'planning' | 'development' | 'database' | 'analysis' | 'research' | 'writing' | 'general';

export type Capability =
  | 'best-coding'
  | 'best-writing'
  | 'best-research'
  | 'best-image'
  | 'best-analysis'
  | 'best-ui'
  | 'best-planning';

/** Channel message from any adapter. */
export interface ChannelMessage {
  id: string;
  channel: ChannelType;
  channelId: string;
  userId: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  replyFn: (message: string) => Promise<void>;
}

/** Project in registry. */
export interface Project {
  id: string;
  name: string;
  path: string;
  githubRepo: string;
  domain: DomainType;
  agents: string[];
  status: 'active' | 'paused' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

/** Task in queue. */
export interface QueuedTask {
  id: string;
  projectId: string;
  message: ChannelMessage;
  priority: number;
  enqueuedAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

/** Model capability routing. */
export interface ModelRoute {
  primary: string;
  review?: string;
  verify?: string;
  fallback?: string;
}

/** Agent definition. */
export interface AgentDefinition {
  id: string;
  name: string;
  domain: DomainType;
  model: string;
  capabilities: string[];
  createdAt: Date;
  dynamic: boolean;
}

/** Health status. */
export interface HealthStatus {
  healthy: boolean;
  uptime: number;
  activeProjects: number;
  queueDepth: number;
  circuitBreakers: Record<string, 'closed' | 'open' | 'half-open'>;
  lastCheck: Date;
}
