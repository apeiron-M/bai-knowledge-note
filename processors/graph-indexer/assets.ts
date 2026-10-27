/**
 * The embedder's runtime — the gte-small model, the ONNX runtime wasm and a
 * self-contained transformers web bundle — lives in its own package, published
 * apart from this one (packages/knowledge-vault-assets). This package names it
 * as an optional peer at exactly ASSETS_VERSION; a test keeps the two equal.
 *
 * Nothing here imports it: the embedder reads its files from disk where it is
 * installed, and from the registry CDN everywhere else.
 */
export const ASSETS_PACKAGE = "@powerhousedao/knowledge-vault-assets";
export const ASSETS_VERSION = "1.0.0";
export const DEFAULT_REGISTRY = "https://registry.vetra.io";

/** The assets package's folder on one registry's CDN (the CDN serves a package's dist/ at its root). */
export function assetsCdnBase(registry: string): string {
  return `${registry.replace(/\/+$/, "")}/-/cdn/${ASSETS_PACKAGE}@${ASSETS_VERSION}/`;
}

/** The registry a module was served from, when it was imported over http(s). */
export function registryOfModule(moduleUrl: string): string | null {
  if (!/^https?:\/\//.test(moduleUrl)) return null;
  const cdn = moduleUrl.indexOf("/-/cdn/");
  return cdn > 0 ? moduleUrl.slice(0, cdn) : new URL(moduleUrl).origin;
}

/**
 * The registries to fetch the assets from, in order and without repeats.
 * A Switchboard resolves its own registry from a constructor option, then
 * PH_REGISTRY_URL, then powerhouse.config.json's packageRegistryUrl; the
 * embedder sees only the last two, so it tries them all and ends on the
 * public registry the assets are published to.
 */
export function registryCandidates(sources: {
  moduleUrl: string;
  env?: string | null;
  configured?: string | null;
}): string[] {
  const all = [registryOfModule(sources.moduleUrl), sources.env, sources.configured, DEFAULT_REGISTRY];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of all) {
    const trimmed = r?.trim().replace(/\/+$/, "");
    if (!trimmed || !/^https?:\/\//.test(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Where an installed or checked-out copy of the model may sit, relative to a
 * directory the embedder walks up from: the installed package (the desktop
 * app; any `ph install`), then this repository's source folder (`ph vetra`,
 * tests).
 */
export const LOCAL_MODEL_DIRS = [
  `node_modules/${ASSETS_PACKAGE}/dist/models`,
  "packages/knowledge-vault-assets/models",
] as const;

/** Where the installed assets package keeps the ONNX runtime wasm. */
export const LOCAL_ORT_DIR = `node_modules/${ASSETS_PACKAGE}/dist/wasm`;

/** The file that proves a models/ folder holds the model. */
export const MODEL_PROBE = "Supabase/gte-small/onnx/model_quantized.onnx";
