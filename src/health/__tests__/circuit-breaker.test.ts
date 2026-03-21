import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerRegistry } from '../circuit-breaker.js';

// Suppress logger output during tests
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 1000,
      name: 'test-breaker',
    });
  });

  it('starts in closed state', () => {
    expect(breaker.getState()).toBe('closed');
    expect(breaker.isOpen()).toBe(false);
  });

  it('opens after 5 failures', async () => {
    const failingFn = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(failingFn)).rejects.toThrow('fail');
    }

    expect(breaker.getState()).toBe('open');
    expect(breaker.isOpen()).toBe(true);
  });

  it('throws circuit open error when open', async () => {
    // Force open by recording failures directly
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(
      "Circuit breaker 'test-breaker' is open",
    );
  });

  it('transitions to half-open after timeout', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Open the breaker (nextAttempt = now + 1000ms)
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('open');

    // Advance time past the timeout
    vi.setSystemTime(now + 2000);

    // execute() checks nextAttempt vs now — transitions to half-open
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    // With successThreshold=2, one success stays half-open
    expect(['half-open', 'closed']).toContain(breaker.getState());

    vi.useRealTimers();
  });

  it('resets on success in half-open state', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    // Open the breaker
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }

    // Advance time past the timeout
    vi.setSystemTime(now + 2000);

    // First execute: transitions to half-open, records one success
    await breaker.execute(() => Promise.resolve('ok'));

    // Second success closes (successThreshold=2)
    await breaker.execute(() => Promise.resolve('ok'));

    expect(breaker.getState()).toBe('closed');
    vi.useRealTimers();
  });
});

describe('CircuitBreakerRegistry', () => {
  beforeEach(() => {
    // Clear the static registry between tests
    const map = CircuitBreakerRegistry.getAll();
    map.clear();
  });

  it('get() returns same instance for same name', () => {
    const a = CircuitBreakerRegistry.get('my-service');
    const b = CircuitBreakerRegistry.get('my-service');
    expect(a).toBe(b);
  });

  it('get() returns different instances for different names', () => {
    const a = CircuitBreakerRegistry.get('service-a');
    const b = CircuitBreakerRegistry.get('service-b');
    expect(a).not.toBe(b);
  });

  it('get() applies default options', () => {
    const cb = CircuitBreakerRegistry.get('defaults-test');
    const stats = cb.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.failures).toBe(0);
  });
});
