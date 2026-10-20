import { useSyncExternalStore } from "react";
import {
  getHostConfig,
  subscribeHostConfig,
  type KnowledgeVaultHostConfig,
} from "./host-config.js";

/** The host declaration as React state: re-renders when the host re-declares (sign-in, another vault). */
export function useHostConfig(): KnowledgeVaultHostConfig | undefined {
  return useSyncExternalStore(subscribeHostConfig, getHostConfig, getHostConfig);
}
