/**
 * How a host that is not Connect declares itself to the vault package.
 *
 * The desktop app writes `globalThis.__knowledgeVaultHost` BEFORE it imports
 * this package, so that `resolveSwitchboardOrigin` follows the declared origin
 * instead of guessing from the hostname, and the package-load boot
 * (`startRemoteFirstBoot`) stays out of Connect-only work. Read at call time,
 * never cached: a host may declare itself after a module was evaluated.
 */
export type KnowledgeVaultHostKind = "connect" | "desktop";

export type KnowledgeVaultHostConfig = {
  kind: KnowledgeVaultHostKind;
  /** Origin every vault call goes to, e.g. "http://127.0.0.1:4201". No path, no trailing slash. */
  switchboardOrigin: string;
};

const SLOT = "__knowledgeVaultHost";
type HostGlobal = typeof globalThis & { [SLOT]?: KnowledgeVaultHostConfig };
const ORIGIN = /^https?:\/\/[^/\s?#]+$/;

export function getHostConfig(): KnowledgeVaultHostConfig | undefined {
  return (globalThis as HostGlobal)[SLOT];
}

export function setHostConfig(
  config: KnowledgeVaultHostConfig | undefined,
): void {
  const g = globalThis as HostGlobal;
  if (config === undefined) {
    delete g[SLOT];
    return;
  }
  if (!ORIGIN.test(config.switchboardOrigin)) {
    throw new Error(
      `switchboardOrigin must be an origin without a path, got "${config.switchboardOrigin}"`,
    );
  }
  g[SLOT] = { kind: config.kind, switchboardOrigin: config.switchboardOrigin };
}

export function isDesktopHost(): boolean {
  return getHostConfig()?.kind === "desktop";
}
