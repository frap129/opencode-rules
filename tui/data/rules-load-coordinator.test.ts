import { describe, expect, it, vi } from 'vitest';
import {
  createRulesLoadCoordinator,
  type RulesLoadTarget,
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
});
