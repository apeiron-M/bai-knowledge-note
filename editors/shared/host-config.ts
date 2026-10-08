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

/** Who the host is signed in as (its own Renown session, held outside the webview). */
export type KnowledgeVaultHostIdentity = {
  address: string;
  did?: string;
  ensName?: string;
};

export type KnowledgeVaultHostConfig = {
  kind: KnowledgeVaultHostKind;
  /** Origin every vault call goes to, e.g. "http://127.0.0.1:4201". No path, no trailing slash. */
  switchboardOrigin: string;
  /**
   * The bearer for that origin, resolved per request. Absent on an open local
   * engine: a missing header is an anonymous caller, which is exactly right there.
   */
  bearer?: () => Promise<string | undefined>;
  /** Absent when nobody is signed in. */
  identity?: KnowledgeVaultHostIdentity;
  /**
   * Runs an OAuth sign-in outside this page and resolves with the returned `code`. The host
   * supplies the callback URL (`buildUrl(callback)` gives the provider URL to open) and receives
   * the redirect itself. A desktop window cannot take a full-page redirect back from the system
   * browser; when this is declared, the chat's OpenRouter connect uses it instead of redirecting.
   */
  externalSignIn?: (buildUrl: (callbackUrl: string) => string) => Promise<string>;
};

/** Dispatched on `globalThis` whenever the declaration changes; `useHostConfig` subscribes to it. */
export const HOST_CHANGED_EVENT = "knowledge-vault-host:changed";

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
    notifyHostChanged();
    return;
  }
  if (!ORIGIN.test(config.switchboardOrigin)) {
    throw new Error(
      `switchboardOrigin must be an origin without a path, got "${config.switchboardOrigin}"`,
    );
  }
  g[SLOT] = {
    kind: config.kind,
    switchboardOrigin: config.switchboardOrigin,
    ...(config.bearer ? { bearer: config.bearer } : {}),
    ...(config.identity ? { identity: { ...config.identity } } : {}),
    ...(config.externalSignIn ? { externalSignIn: config.externalSignIn } : {}),
  };
  notifyHostChanged();
}

const listeners = new Set<() => void>();

/**
 * Called by `setHostConfig`. A host that writes the slot directly (it loads
 * before this module) dispatches `HOST_CHANGED_EVENT` on `globalThis` instead;
 * subscribers hear both, each change exactly once.
 */
function notifyHostChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeHostConfig(onChange: () => void): () => void {
  listeners.add(onChange);
  const g = globalThis as typeof globalThis & {
    addEventListener?: (type: string, cb: () => void) => void;
    removeEventListener?: (type: string, cb: () => void) => void;
  };
  const dom = typeof g.addEventListener === "function" && typeof g.removeEventListener === "function";
  if (dom) g.addEventListener(HOST_CHANGED_EVENT, onChange);
  return () => {
    listeners.delete(onChange);
    if (dom) g.removeEventListener(HOST_CHANGED_EVENT, onChange);
  };
}

export function isDesktopHost(): boolean {
  return getHostConfig()?.kind === "desktop";
}
