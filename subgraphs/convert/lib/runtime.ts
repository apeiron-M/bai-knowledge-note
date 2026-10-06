import type { ConvertRouteDeps } from "./deps.js";
import { createHttpConversionService } from "./service.js";

/**
 * The conversion service, settable while the engine runs.
 *
 * A same-process host — the desktop app's sidecar, which starts the Switchboard
 * inside its own process — points the vault at a converter it manages: on this
 * computer, another server, or none. The routes read `deps.service` on every
 * request (routes/*.ts), so swapping it here needs no re-registration and no
 * restart: an in-flight conversion finishes on the old service, the next
 * request uses the new one. The host finds the setter under a well-known global
 * symbol, so it works whichever module instance loaded this file.
 */
export const CONVERT_REGISTRY = Symbol.for("@powerhousedao/knowledge-note/convert");

export type ConvertRegistry = {
  setServiceUrl: (url: string | null) => void;
  getServiceUrl: () => string | null;
};

let live: ConvertRouteDeps | null = null;
let runtimeUrl: string | null = null;

/**
 * Called by `ConvertSubgraph.onSetup` with the deps it configured from the
 * environment. Returns the one live deps object: the first ever bound — the
 * routes captured it at their once-per-scope registration — with a reload's
 * fresh environment config carried over. A runtime URL set earlier wins.
 */
export function bindRuntimeDeps(deps: ConvertRouteDeps): ConvertRouteDeps {
  if (live && live !== deps) {
    if (deps.service) live.service = deps.service;
    else delete live.service;
    if (deps.source) live.source = deps.source;
    else delete live.source;
  } else {
    live = deps;
  }
  if (runtimeUrl !== null) apply(runtimeUrl);
  (globalThis as Record<symbol, unknown>)[CONVERT_REGISTRY] = {
    setServiceUrl: setConversionServiceUrl,
    getServiceUrl: getConversionServiceUrl,
  } satisfies ConvertRegistry;
  return live;
}

/**
 * Point the vault at a conversion service; `null` means none — it also
 * replaces a service configured from the environment, until the next setup.
 */
export function setConversionServiceUrl(url: string | null): void {
  const trimmed = url?.trim().replace(/\/+$/, "") ?? "";
  runtimeUrl = trimmed || null;
  apply(runtimeUrl);
}

export function getConversionServiceUrl(): string | null {
  return runtimeUrl;
}

/** For tests, and for a host that tears the engine down in-process. */
export function resetConversionRuntime(): void {
  live = null;
  runtimeUrl = null;
  delete (globalThis as Record<symbol, unknown>)[CONVERT_REGISTRY];
}

function apply(url: string | null): void {
  if (!live) return;
  if (url) {
    live.service = createHttpConversionService({ baseUrl: url });
    live.source = "runtime";
  } else {
    delete live.service;
    delete live.source;
  }
}
