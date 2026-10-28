/**
 * Dev-only in-browser parity of configuration C: runs the shipped core on
 * the wllama backends over 20 dev items (held-out-3/4) and compares with
 * the rig's stored native outputs. Bars (accepted for WebGPU vs Metal):
 * identical gate decisions and step-2 args, Kev |dp| <= 0.05, median trie
 * |d| <= 0.08 nat. Exposed as `window.__baiChatParityC()` behind the debug
 * flag; see `installParityC`.
 *
 * The harness moved to nl-runtime/dev in M1 (`runBrowserParityC`,
 * `installParityC`); this thin installer passes the vault's items, catalog,
 * artifact manifest and tables.
 */
import type { TrieMode } from "nl-runtime";
import {
  type BrowserParityInputs,
  type BrowserParityOptions,
  installParityC as coreInstallParityC,
  type ParityDeps,
  type ParityReport,
  runBrowserParityC,
} from "nl-runtime/dev";
import { v1Catalog } from "../core/catalog-models.js";
import { OP_DESCRIPTIONS } from "../core/op-descriptions.js";
import {
  CURRENT_LISTS,
  REF_EXTRACTORS,
  STATE_CHOICES,
} from "../core/ref-candidates.js";
import { VAULT_ARTIFACTS } from "../vault-artifacts.js";

export {
  PARITY_BARS,
  type ParityDeps,
  type ParityItemResult,
  type ParityReport,
} from "nl-runtime/dev";

declare global {
  interface Window {
    __baiChatParityC?: (mode?: TrieMode) => Promise<ParityReport>;
  }
}

function inputs(): BrowserParityInputs {
  return {
    // A static JSON import behind a dynamic one: loaded only when the check runs.
    items: async () => (await import("./parity-c-items-asset.js")).default,
    catalog: v1Catalog(),
    manifest: VAULT_ARTIFACTS,
    tables: {
      refExtractors: REF_EXTRACTORS,
      stateChoices: STATE_CHOICES,
      currentLists: CURRENT_LISTS,
      opDescriptions: OP_DESCRIPTIONS,
    },
  };
}

export function runParityC(
  deps: ParityDeps,
  opts: BrowserParityOptions = {},
): Promise<ParityReport> {
  return runBrowserParityC(deps, inputs(), opts);
}

/** Expose `window.__baiChatParityC()` (the debug flag gates the caller). */
export function installParityC(getDeps: () => Promise<ParityDeps>): void {
  coreInstallParityC({ ...inputs(), getDeps, globalName: "__baiChatParityC" });
}
