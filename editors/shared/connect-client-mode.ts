/**
 * Connect's official remote client (`connect.instance.reactorClient: "remote"`,
 * or `?reactorClient=remote`): no reactor runs in the tab, and
 * `window.ph.reactorClient` is a router over one Switchboard backend. Connect
 * then reads, writes and lists drives against the Switchboard itself, so the
 * vault's own remote-first layer (built to stop a local replica from syncing a
 * vault) stands down, and the vault talks to the Switchboard Connect uses.
 *
 * Connect sets `reactorClientModule` before `reactorClient` in every mode that
 * builds a reactor in the tab and leaves it unset in remote mode; only the
 * router has `describeRouting`. A desktop host's client is a plain
 * GraphQLReactorClient, so it never reads as Connect's remote mode.
 */
type PHView = {
  reactorClient?: unknown;
  reactorClientModule?: unknown;
  defaultDrivesUrl?: unknown;
};

function ph(): PHView | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ph?: PHView }).ph;
}

export function connectRunsRemoteClient(): boolean {
  const g = ph();
  if (!g?.reactorClient || g.reactorClientModule) return false;
  return typeof (g.reactorClient as { describeRouting?: unknown }).describeRouting === "function";
}

/**
 * The Switchboard Connect's remote client talks to, as an origin (plus any
 * path prefix), or null when Connect is not in remote mode. Connect derives
 * it from its first default drive's URL, `<origin>[/<prefix>]/d/<slug>`; the
 * same rule here keeps the vault on the same server.
 */
export function connectSwitchboardOrigin(): string | null {
  if (!connectRunsRemoteClient()) return null;
  const url = ph()?.defaultDrivesUrl;
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const prefix = /^(.*)\/d\/[^/]+\/?$/.exec(parsed.pathname)?.[1];
  return prefix === undefined ? null : `${parsed.origin}${prefix}`;
}
