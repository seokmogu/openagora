import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import type { Capability } from '../types/index.js';
import { logger } from '../utils/logger.js';

interface ModelConfig {
  type: 'cli' | 'api';
  command?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

interface CapabilityRoute {
  primary: string;
  review?: string;
  verify?: string;
  synthesis?: string;
  fallback?: string;
}

interface ModelsYaml {
  capabilities: Record<string, CapabilityRoute>;
  models: Record<string, ModelConfig>;
}

export interface ModelRunResult {
  output: string;
  model: string;
  role: 'primary' | 'review' | 'verify' | 'synthesis';
}

export class ModelRouter {
  private config: ModelsYaml;

  constructor(configDir: string) {
    try {
      const raw = readFileSync(join(configDir, 'models.yaml'), 'utf-8');
      this.config = yaml.parse(raw) as ModelsYaml;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn('ModelRouter: models.yaml not found, using defaults', { configDir });
        this.config = { capabilities: {}, models: {} };
      } else {
        throw err;
      }
    }
  }

  /** Check if a model is configured and has credentials. */
  isModelAvailable(modelName: string): boolean {
    const cfg = this.config.models[modelName];
    if (!cfg) return false;
    if (cfg.type === 'cli') return true; // CLI models use local auth
    if (cfg.apiKey?.startsWith('${') && cfg.apiKey.endsWith('}')) {
      const envVar = cfg.apiKey.slice(2, -1);
      return !!process.env[envVar];
    }
    return !!cfg.apiKey;
  }

  /** Find first available model from candidates, or null if none available. */
  findAvailable(candidates: string[]): string | null {
    for (const name of candidates) {
      if (this.isModelAvailable(name)) return name;
    }
    return null;
  }

  /** Get model names for a capability (primary + optional review/verify). */
  getRoute(capability: Capability): CapabilityRoute {
    const route = this.config.capabilities[capability];
    if (!route) {
      logger.warn('No route found for capability, using best-coding fallback', { capability });
      return this.config.capabilities['best-coding'] ?? { primary: 'claude' };
    }
    return route;
  }

  /** Get model config by name. Resolves env var tokens in apiKey. */
  getModelConfig(modelName: string): ModelConfig {
    const cfg = this.config.models[modelName];
    if (!cfg) throw new Error(`Unknown model: ${modelName}`);

    if (cfg.apiKey?.startsWith('${') && cfg.apiKey.endsWith('}')) {
      const envVar = cfg.apiKey.slice(2, -1);
      const resolved = process.env[envVar] ?? '';
      return { ...cfg, apiKey: resolved };
    }
    return cfg;
  }

  /** Run a prompt against a specific capability role. */
  async run(capability: Capability, prompt: string, role: keyof CapabilityRoute = 'primary'): Promise<ModelRunResult> {
    const route = this.getRoute(capability);
    const modelName = route[role] ?? route.primary;
    return this.runWithModel(modelName, prompt, role);
  }

  /** Run a prompt against an explicitly named model. */
  async runWithModel(modelName: string, prompt: string, role: keyof CapabilityRoute = 'primary'): Promise<ModelRunResult> {
    const modelCfg = this.getModelConfig(modelName);

    logger.info('ModelRouter: running', { model: modelName, role });

    if (modelCfg.type === 'cli') {
      return this.runCli(modelName, modelCfg, prompt, role);
    }
    return this.runApi(modelName, modelCfg, prompt, role);
  }

  private async runCli(
    modelName: string,
    cfg: ModelConfig,
    prompt: string,
    role: keyof CapabilityRoute,
  ): Promise<ModelRunResult> {
    const { spawn } = await import('node:child_process');

    return new Promise((resolve, reject) => {
      const cmd = cfg.command ?? modelName;
      const child = spawn(cmd, ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let errOutput = '';

      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { errOutput += chunk.toString(); });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`${cmd} exited with code ${code}: ${errOutput}`));
          return;
        }
        resolve({ output: output.trim(), model: modelName, role: role as ModelRunResult['role'] });
      });

      child.on('error', reject);
    });
  }

  private async runApi(
    modelName: string,
    cfg: ModelConfig,
    prompt: string,
    role: keyof CapabilityRoute,
  ): Promise<ModelRunResult> {
    if (!cfg.endpoint) throw new Error(`No endpoint for model: ${modelName}`);
    if (!cfg.apiKey) throw new Error(`No API key for model: ${modelName}`);

    const body = this.buildApiBody(modelName, cfg, prompt);

    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min API timeout
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status} from ${modelName}: ${text}`);
    }

    const json = await res.json() as Record<string, unknown>;
    const output = this.extractApiOutput(modelName, json);

    return { output, model: modelName, role: role as ModelRunResult['role'] };
  }

  private buildApiBody(modelName: string, cfg: ModelConfig, prompt: string): Record<string, unknown> {
    // Perplexity / OpenAI-compatible format
    if (modelName === 'perplexity' || modelName === 'dalle3') {
      return {
        model: cfg.model ?? modelName,
        messages: [{ role: 'user', content: prompt }],
      };
    }

    // Gemini format
    if (modelName === 'gemini') {
      return {
        contents: [{ parts: [{ text: prompt }] }],
      };
    }

    // Generic fallback
    return { prompt };
  }

  private extractApiOutput(modelName: string, json: Record<string, unknown>): string {
    // OpenAI-compatible response
    if (modelName === 'perplexity') {
      const choices = json.choices as Array<{ message: { content: string } }> | undefined;
      return choices?.[0]?.message?.content ?? '';
    }

    // Gemini response
    if (modelName === 'gemini') {
      const candidates = json.candidates as Array<{ content: { parts: Array<{ text: string }> } }> | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    // DALL-E image response — return URL
    if (modelName === 'dalle3') {
      const data = json.data as Array<{ url: string }> | undefined;
      return data?.[0]?.url ?? '';
    }

    return JSON.stringify(json);
  }
}
