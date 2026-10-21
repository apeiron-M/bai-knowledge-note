import { useSyncExternalStore } from "react";
import { getHostConfig, subscribeHostConfig, type HostPipelineState } from "./host-config.js";

/** Hears the pipeline's changes, and a host that declares, replaces or drops its pipeline. */
function subscribe(onChange: () => void): () => void {
  let unsubscribePipeline = getHostConfig()?.pipeline?.subscribe(onChange);
  const unsubscribeHost = subscribeHostConfig(() => {
    unsubscribePipeline?.();
    unsubscribePipeline = getHostConfig()?.pipeline?.subscribe(onChange);
    onChange();
  });
  return () => {
    unsubscribePipeline?.();
    unsubscribeHost();
  };
}

const snapshot = (): HostPipelineState["kind"] | undefined => getHostConfig()?.pipeline?.state().kind;

/**
 * The browser vault's AI, as its pipeline reports it: undefined where no host pipeline exists
 * (Connect, the desktop app). Editors never import `browser/*`; this is how they learn its state.
 */
export function useHostPipeline(): { ai: HostPipelineState["kind"] | undefined; failureReason(taskId: string): string | null } {
  const ai = useSyncExternalStore(subscribe, snapshot, () => undefined);
  return { ai, failureReason: (taskId) => getHostConfig()?.pipeline?.failureReason(taskId) ?? null };
}
