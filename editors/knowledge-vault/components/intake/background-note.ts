import { isDesktopHost } from "../../../shared/host-config.js";

/**
 * What survives and what does not, said once in the vault's words: the batch
 * outlives every view, vault and window switch, but not the page itself.
 */
export function backgroundNote(): string {
  return isDesktopHost()
    ? "Converting carries on in the background while you switch views, vaults or windows. Quitting the app stops it."
    : "Converting carries on in the background while you switch views, drives or windows. Closing or reloading this tab stops it.";
}
