import { describe, expect, it, vi } from 'vitest';
import {
  createRulesLoadCoordinator,
  type RulesLoadTarget,
  type RulesRetryScheduler,
} from './rules-load-coordinator.js';
import type { LoadSidebarRulesResult } from './rules.js';

function result(hasEvaluationState = true): LoadSidebarRulesResult {
  return { rules: [], skippedCount: 0, hasEvaluationState };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function fakeScheduler(): {
  schedule: RulesRetryScheduler;
  active: () => Array<{ delayMs: number; run: () => void }>;
} {
  const tasks: Array<{
    delayMs: number;
    callback: () => void;
    cancelled: boolean;
  }> = [];

  return {
    schedule(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    active: () =>
      tasks
        .filter(task => !task.cancelled)
        .map(task => ({
          delayMs: task.delayMs,
          run: () => {
            task.cancelled = true;
            task.callback();
          },
        })),
  };
}

const target: RulesLoadTarget = {
  projectDir: '/project',
  sessionId: 'ses_test',
};

describe('createRulesLoadCoordinator', () => {
  it('replays a refresh requested during the initial load', async () => {
    const loads: Array<ReturnType<typeof deferred<LoadSidebarRulesResult>>> =
      [];
    const published: LoadSidebarRulesResult[] = [];
    const coordinator = createRulesLoadCoordinator({
      load: () => {
        const load = deferred<LoadSidebarRulesResult>();
        loads.push(load);
        return load.promise;
      },
      onReset: vi.fn(),
      onResult: value => published.push(value),
      onError: vi.fn(),
    });

    coordinator.reset(target);
    coordinator.refresh();
    expect(loads).toHaveLength(1);

    loads[0]!.resolve(result());
    await flushPromises();
    expect(published).toHaveLength(1);
    expect(loads).toHaveLength(2);

    loads[1]!.resolve(result());
    await flushPromises();
    expect(published).toHaveLength(2);
    expect(loads).toHaveLength(2);
  });

  it('retries fallback state until evaluated state is available', async () => {
    const scheduler = fakeScheduler();
    const published: LoadSidebarRulesResult[] = [];
    let evaluated = false;
    const coordinator = createRulesLoadCoordinator({
      load: async () => result(evaluated),
      onReset: vi.fn(),
      onResult: value => published.push(value),
      onError: vi.fn(),
      schedule: scheduler.schedule,
    });

    coordinator.reset(target);
    await flushPromises();
    expect(published.map(value => value.hasEvaluationState)).toEqual([false]);
    expect(scheduler.active().map(task => task.delayMs)).toEqual([100]);

    evaluated = true;
    scheduler.active()[0]!.run();
    await flushPromises();
    expect(published.map(value => value.hasEvaluationState)).toEqual([
      false,
      true,
    ]);
    expect(scheduler.active()).toHaveLength(0);
  });

  it('coalesces multiple in-flight refreshes into one replay', async () => {
    const loads: Array<ReturnType<typeof deferred<LoadSidebarRulesResult>>> =
      [];
    const coordinator = createRulesLoadCoordinator({
      load: () => {
        const load = deferred<LoadSidebarRulesResult>();
        loads.push(load);
        return load.promise;
      },
      onReset: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
    });

    coordinator.reset(target);
    coordinator.refresh();
    coordinator.refresh();
    coordinator.refresh();
    loads[0]!.resolve(result());
    await flushPromises();

    expect(loads).toHaveLength(2);
  });

  it('cancels a scheduled retry when an external refresh starts', async () => {
    const scheduler = fakeScheduler();
    let loadCount = 0;
    const coordinator = createRulesLoadCoordinator({
      load: async () => {
        loadCount++;
        return result(false);
      },
      onReset: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
      schedule: scheduler.schedule,
    });

    coordinator.reset(target);
    await flushPromises();
    const staleRetry = scheduler.active()[0]!;

    coordinator.refresh();
    await flushPromises();
    staleRetry.run();
    await flushPromises();

    expect(loadCount).toBe(2);
    expect(scheduler.active()).toHaveLength(1);
    expect(scheduler.active()[0]!.delayMs).toBe(100);
  });

  it('starts a fresh retry budget when a coalesced replay has no state', async () => {
    const scheduler = fakeScheduler();
    const loads: Array<ReturnType<typeof deferred<LoadSidebarRulesResult>>> =
      [];
    const coordinator = createRulesLoadCoordinator({
      load: () => {
        const load = deferred<LoadSidebarRulesResult>();
        loads.push(load);
        return load.promise;
      },
      onReset: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
      schedule: scheduler.schedule,
    });

    coordinator.reset(target);
    coordinator.refresh();
    loads[0]!.resolve(result(false));
    await flushPromises();
    loads[1]!.resolve(result(false));
    await flushPromises();

    expect(scheduler.active().map(task => task.delayMs)).toEqual([100]);
  });

  it('cancels a scheduled retry when resetting to a new target', async () => {
    const scheduler = fakeScheduler();
    const loadedTargets: RulesLoadTarget[] = [];
    const coordinator = createRulesLoadCoordinator({
      load: async loadTarget => {
        loadedTargets.push(loadTarget);
        return result(false);
      },
      onReset: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
      schedule: scheduler.schedule,
    });

    coordinator.reset(target);
    await flushPromises();
    const staleRetry = scheduler.active()[0]!;
    const nextTarget = { projectDir: '/other', sessionId: 'ses_other' };

    coordinator.reset(nextTarget);
    await flushPromises();
    staleRetry.run();
    await flushPromises();

    expect(loadedTargets).toEqual([target, nextTarget]);
    expect(scheduler.active()).toHaveLength(1);
  });

  it('ignores an unresolved result after resetting to a new target', async () => {
    const loads: Array<ReturnType<typeof deferred<LoadSidebarRulesResult>>> =
      [];
    const published: LoadSidebarRulesResult[] = [];
    const coordinator = createRulesLoadCoordinator({
      load: () => {
        const load = deferred<LoadSidebarRulesResult>();
        loads.push(load);
        return load.promise;
      },
      onReset: vi.fn(),
      onResult: value => published.push(value),
      onError: vi.fn(),
    });

    coordinator.reset(target);
    coordinator.reset({ projectDir: '/other', sessionId: 'ses_other' });
    loads[0]!.resolve(result());
    await flushPromises();
    expect(published).toHaveLength(0);

    loads[1]!.resolve(result());
    await flushPromises();
    expect(published).toHaveLength(1);
  });

  it('settles rejected loads so a later refresh can run', async () => {
    const load = vi.fn(
      (_target: RulesLoadTarget): Promise<LoadSidebarRulesResult> =>
        Promise.resolve(result())
    );
    load.mockRejectedValueOnce(new Error('failed'));
    const onError = vi.fn();
    const coordinator = createRulesLoadCoordinator({
      load,
      onReset: vi.fn(),
      onResult: vi.fn(),
      onError,
    });

    coordinator.reset(target);
    await flushPromises();
    coordinator.refresh();
    await flushPromises();

    expect(onError).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores unresolved loads after disposal', async () => {
    const firstLoad = deferred<LoadSidebarRulesResult>();
    const onResult = vi.fn();
    const coordinator = createRulesLoadCoordinator({
      load: () => firstLoad.promise,
      onReset: vi.fn(),
      onResult,
      onError: vi.fn(),
    });

    coordinator.reset(target);
    coordinator.dispose();
    firstLoad.resolve(result());
    await flushPromises();

    expect(onResult).not.toHaveBeenCalled();
  });

  it('stops retrying after the bounded retry schedule is exhausted', async () => {
    const scheduler = fakeScheduler();
    const load = vi.fn(async () => result(false));
    const coordinator = createRulesLoadCoordinator({
      load,
      onReset: vi.fn(),
      onResult: vi.fn(),
      onError: vi.fn(),
      schedule: scheduler.schedule,
    });

    coordinator.reset(target);
    await flushPromises();
    for (const delayMs of [100, 250, 500, 1000, 2000, 4000]) {
      const scheduled = scheduler.active();
      expect(scheduled.map(task => task.delayMs)).toEqual([delayMs]);
      scheduled[0]!.run();
      await flushPromises();
    }

    expect(load).toHaveBeenCalledTimes(7);
    expect(scheduler.active()).toHaveLength(0);
  });
});
