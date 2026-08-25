import type { LoadSidebarRulesResult } from './rules.js';

export interface RulesLoadTarget {
  projectDir: string | null;
  sessionId?: string;
}

export type RulesRetryScheduler = (
  callback: () => void,
  delayMs: number
) => () => void;

interface RulesLoadCoordinatorOptions {
  load: (target: RulesLoadTarget) => Promise<LoadSidebarRulesResult>;
  onReset: (target: RulesLoadTarget) => void;
  onResult: (result: LoadSidebarRulesResult, target: RulesLoadTarget) => void;
  onError: (error: unknown, target: RulesLoadTarget, reset: boolean) => void;
  schedule?: RulesRetryScheduler;
}

export interface RulesLoadCoordinator {
  reset(target: RulesLoadTarget): void;
  refresh(): void;
  dispose(): void;
}

const RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000, 4000] as const;

const scheduleTimeout: RulesRetryScheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export function createRulesLoadCoordinator(
  options: RulesLoadCoordinatorOptions
): RulesLoadCoordinator {
  const schedule = options.schedule ?? scheduleTimeout;
  let currentTarget: RulesLoadTarget | undefined;
  let targetGeneration = 0;
  let nextRequestId = 0;
  let activeRequest:
    { id: number; generation: number; reset: boolean } | undefined;
  let pendingRefresh = false;
  let retryIndex = 0;
  let cancelRetry: (() => void) | undefined;
  let disposed = false;

  function cancelScheduledRetry(): void {
    cancelRetry?.();
    cancelRetry = undefined;
  }

  function isCurrent(
    request: NonNullable<typeof activeRequest>,
    target: RulesLoadTarget
  ): boolean {
    return (
      !disposed &&
      activeRequest?.id === request.id &&
      request.generation === targetGeneration &&
      target === currentTarget
    );
  }

  function scheduleRetry(target: RulesLoadTarget, generation: number): void {
    const delayMs = RETRY_DELAYS_MS[retryIndex];
    if (delayMs === undefined) return;
    retryIndex++;

    let cancelThisRetry: () => void = () => {};
    const cancelTimer = schedule(() => {
      if (
        disposed ||
        cancelRetry !== cancelThisRetry ||
        generation !== targetGeneration ||
        target !== currentTarget
      ) {
        return;
      }
      cancelRetry = undefined;
      startLoad(target, generation, false);
    }, delayMs);
    cancelThisRetry = () => cancelTimer();
    cancelRetry = cancelThisRetry;
  }

  function settlePendingRefresh(
    target: RulesLoadTarget,
    generation: number
  ): boolean {
    if (!pendingRefresh) return false;
    pendingRefresh = false;
    cancelScheduledRetry();
    retryIndex = 0;
    startLoad(target, generation, false);
    return true;
  }

  function startLoad(
    target: RulesLoadTarget,
    generation: number,
    reset: boolean
  ): void {
    if (disposed) return;
    const request = {
      id: ++nextRequestId,
      generation,
      reset,
    };
    activeRequest = request;

    void options.load(target).then(
      result => {
        if (!isCurrent(request, target)) return;
        activeRequest = undefined;
        options.onResult(result, target);

        if (settlePendingRefresh(target, generation)) return;
        if (result.hasEvaluationState) {
          cancelScheduledRetry();
          retryIndex = 0;
          return;
        }
        scheduleRetry(target, generation);
      },
      error => {
        if (!isCurrent(request, target)) return;
        activeRequest = undefined;
        options.onError(error, target, reset);
        void settlePendingRefresh(target, generation);
      }
    );
  }

  return {
    reset(target): void {
      if (disposed) return;
      cancelScheduledRetry();
      pendingRefresh = false;
      retryIndex = 0;
      currentTarget = target;
      targetGeneration++;
      options.onReset(target);
      startLoad(target, targetGeneration, true);
    },

    refresh(): void {
      if (disposed || !currentTarget) return;
      cancelScheduledRetry();
      retryIndex = 0;
      if (activeRequest) {
        pendingRefresh = true;
        return;
      }
      startLoad(currentTarget, targetGeneration, false);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      targetGeneration++;
      activeRequest = undefined;
      pendingRefresh = false;
      cancelScheduledRetry();
      currentTarget = undefined;
    },
  };
}
