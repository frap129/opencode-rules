import type { LoadSidebarRulesResult } from './rules.js';

export interface RulesLoadTarget {
  projectDir: string | null;
  sessionId?: string;
}

interface RulesLoadCoordinatorOptions {
  load: (target: RulesLoadTarget) => Promise<LoadSidebarRulesResult>;
  onReset: (target: RulesLoadTarget) => void;
  onResult: (result: LoadSidebarRulesResult, target: RulesLoadTarget) => void;
  onError: (error: unknown, target: RulesLoadTarget, reset: boolean) => void;
}

export interface RulesLoadCoordinator {
  reset(target: RulesLoadTarget): void;
  refresh(): void;
  dispose(): void;
}

export function createRulesLoadCoordinator(
  options: RulesLoadCoordinatorOptions
): RulesLoadCoordinator {
  let currentTarget: RulesLoadTarget | undefined;
  let targetGeneration = 0;
  let nextRequestId = 0;
  let activeRequest:
    { id: number; generation: number; reset: boolean } | undefined;
  let pendingRefresh = false;
  let disposed = false;

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

  function settlePendingRefresh(
    target: RulesLoadTarget,
    generation: number
  ): boolean {
    if (!pendingRefresh) return false;
    pendingRefresh = false;
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

        void settlePendingRefresh(target, generation);
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
      pendingRefresh = false;
      currentTarget = target;
      targetGeneration++;
      options.onReset(target);
      startLoad(target, targetGeneration, true);
    },

    refresh(): void {
      if (disposed || !currentTarget) return;
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
      currentTarget = undefined;
    },
  };
}
