/**
 * The name the vault gives itself.
 *
 * Prefers the name in `bai/vault-config` over the drive's node name: the
 * config is the vault describing what it is ("The Knowledge Vault"), while the
 * drive name is whatever the drive happened to be created as ("knowledge
 * vault"). Falls back to the drive name, then to a generic label, so a vault
 * with no config still has a heading.
 *
 * The name lives in document state, not in the drive tree, so the node list
 * cannot answer this and neither can `useVaultDocIndex` (whose `title` is the
 * tree's node name). This is a targeted state read through
 * `useReactorDocsWithRefetch` — one document, served from the Switchboard via
 * the shared reactor-doc cache. `useDocumentsInSelectedDrive` is deliberately
 * avoided: it would pull full state for the whole corpus.
 *
 * Lives in a hook rather than inside the sidebar because the chat greeting
 * must resolve the name identically — two copies would drift.
 */
import { useMemo } from "react";
import {
  isFileNodeKind,
  useNodesInSelectedDrive,
  useSelectedDrive,
} from "@powerhousedao/reactor-browser";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "./use-reactor-docs.js";

export function useVaultName(): string {
  const nodes = useNodesInSelectedDrive();
  const [selectedDrive] = useSelectedDrive();

  const configSpecs = useMemo<ReactorDocSpec[]>(() => {
    // Momentarily undefined during drive-switch teardown.
    const node = (nodes ?? [])
      .filter(isFileNodeKind)
      .find((n) => n.documentType === "bai/vault-config");
    return node
      ? [{ id: node.id, documentType: "bai/vault-config", name: node.name }]
      : [];
  }, [nodes]);

  const { docs } = useReactorDocsWithRefetch(configSpecs, {
    // The name changes rarely, and the config editor announces its own writes,
    // so this only needs to catch edits made elsewhere.
    pollMs: 60_000,
    retainKey: "vault-name-config",
  });

  const configName = useMemo(() => {
    // `.at()` rather than `[0]`: it is typed `T | undefined`, matching the
    // real possibility of an empty list before the fetch resolves.
    const doc = docs.at(0);
    if (!doc) return null;
    const global = (
      doc.state as unknown as { global?: { name?: string | null } }
    ).global;
    const name = global?.name?.trim();
    return name ? name : null;
  }, [docs]);

  // Typed non-null upstream, but during drive-switch teardown it can be
  // momentarily absent at runtime — guard structurally, not with `?.`.
  const header = (selectedDrive as { header?: { name?: string } }).header;
  return configName || header?.name || "Knowledge Vault";
}
