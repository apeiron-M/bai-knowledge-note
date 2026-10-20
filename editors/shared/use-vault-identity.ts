import { useRenownAuth } from "@powerhousedao/reactor-browser";
import { useHostConfig } from "./use-host-config.js";

/**
 * Who the vault acts as. Under a desktop host that is the host's own identity
 * (its Renown session lives outside the webview, in the engine); under Connect
 * it is the ambient Renown session. One source for the gate, the Access view
 * and the live feed, so they can never disagree.
 */
export function useVaultIdentity(): {
  address: string | undefined;
  ensName: string | undefined;
  /** True under a desktop host: signing in happens in the app's Settings, not here. */
  hosted: boolean;
} {
  const host = useHostConfig();
  const renown = useRenownAuth();
  if (host?.kind === "desktop") {
    return { address: host.identity?.address, ensName: host.identity?.ensName, hosted: true };
  }
  return { address: renown.address, ensName: renown.ensName, hosted: false };
}
