import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ProcessWatcher } from '../process-watcher.js';

describe('ProcessWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('register()', () => {
    it('tracks a child process', () => {
      const watcher = new ProcessWatcher();
      watcher.register(1234, 'proj-1');
      // No throw means success; we verify via heartbeat/unregister
    });
  });

  describe('unregister()', () => {
    it('removes a tracked process', () => {
      const watcher = new ProcessWatcher();
      watcher.register(1234, 'proj-1');
      watcher.unregister(1234);
      // Calling unregister again should be safe (no-op)
      watcher.unregister(1234);
    });
  });

  describe('heartbeat()', () => {
    it('updates timestamp for existing process', () => {
      const watcher = new ProcessWatcher();
      watcher.register(1234, 'proj-1');
      // Advance time, then heartbeat
      vi.advanceTimersByTime(5000);
      watcher.heartbeat(1234);
      // No throw means success
    });

    it('does nothing for unknown pid', () => {
      const watcher = new ProcessWatcher();
      // Should not throw
      watcher.heartbeat(9999);
    });
  });

  describe('timeout detection', () => {
    it('kills process after timeout', () => {
      const watcher = new ProcessWatcher();
      const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

      watcher.register(1234, 'proj-1', 60_000); // 60s timeout
      watcher.start();

      // Advance past the watch interval + timeout
      vi.advanceTimersByTime(30_000); // first check at 30s - not timed out yet
      expect(mockKill).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60_000); // now at 90s, past 60s timeout
      expect(mockKill).toHaveBeenCalled();

      watcher.stop();
      mockKill.mockRestore();
    });

    it('sends SIGKILL', () => {
      const watcher = new ProcessWatcher();
      const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

      watcher.register(5678, 'proj-2', 10_000);
      watcher.start();

      vi.advanceTimersByTime(60_000); // well past timeout

      expect(mockKill).toHaveBeenCalledWith(-5678, 'SIGKILL');

      watcher.stop();
      mockKill.mockRestore();
    });

    it('falls back to direct kill if process group kill fails', () => {
      const watcher = new ProcessWatcher();
      let callCount = 0;
      const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('ESRCH');
        return true;
      });

      watcher.register(9999, 'proj-3', 10_000);
      watcher.start();

      vi.advanceTimersByTime(60_000);

      // First call: -9999 (group kill, throws)
      // Second call: 9999 (direct kill)
      expect(mockKill).toHaveBeenCalledTimes(2);

      watcher.stop();
      mockKill.mockRestore();
    });
  });

  describe('start/stop', () => {
    it('start begins watching interval', () => {
      const watcher = new ProcessWatcher();
      watcher.start();
      // Calling start again is a no-op
      watcher.start();
      watcher.stop();
    });

    it('stop clears interval', () => {
      const watcher = new ProcessWatcher();
      watcher.start();
      watcher.stop();
      // Calling stop again is safe
      watcher.stop();
    });
  });
});
