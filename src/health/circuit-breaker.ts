import { logger } from '../utils/logger.js';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  name: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: Date;
  private nextAttempt?: Date;

  constructor(private options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      const now = new Date();
      if (this.nextAttempt && now >= this.nextAttempt) {
        this.transitionTo('half-open');
      } else {
        throw new Error(`Circuit breaker '${this.options.name}' is open`);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  recordSuccess(): void {
    this.successes++;
    if (this.state === 'half-open') {
      if (this.successes >= this.options.successThreshold) {
        this.reset();
      }
    } else if (this.state === 'closed') {
      this.failures = 0;
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = new Date();

    if (this.state === 'half-open') {
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.failures >= this.options.failureThreshold) {
      this.transitionTo('open');
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state === 'open';
  }

  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = undefined;
    this.transitionTo('closed');
  }

  getStats(): { state: CircuitState; failures: number; successes: number; lastFailure?: Date } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailureTime,
    };
  }

  private transitionTo(next: CircuitState): void {
    if (this.state === next) return;
    logger.info('Circuit breaker state change', {
      name: this.options.name,
      from: this.state,
      to: next,
    });
    this.state = next;
    if (next === 'open') {
      this.successes = 0;
      this.nextAttempt = new Date(Date.now() + this.options.timeout);
    }
  }
}

export class CircuitBreakerRegistry {
  private static breakers = new Map<string, CircuitBreaker>();

  static get(name: string, options?: Partial<Omit<CircuitBreakerOptions, 'name'>>): CircuitBreaker {
    let breaker = CircuitBreakerRegistry.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker({
        failureThreshold: options?.failureThreshold ?? 5,
        successThreshold: options?.successThreshold ?? 2,
        timeout: options?.timeout ?? 60_000,
        name,
      });
      CircuitBreakerRegistry.breakers.set(name, breaker);
      logger.debug('Circuit breaker registered', { name });
    }
    return breaker;
  }

  static getAll(): Map<string, CircuitBreaker> {
    return CircuitBreakerRegistry.breakers;
  }

  static getStats(): Record<string, ReturnType<CircuitBreaker['getStats']>> {
    const stats: Record<string, ReturnType<CircuitBreaker['getStats']>> = {};
    for (const [name, breaker] of CircuitBreakerRegistry.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }
}
