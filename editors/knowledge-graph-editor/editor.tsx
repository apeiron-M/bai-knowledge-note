import { useCallback } from "react";
import { generateId } from "document-model/core";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  useSelectedKnowledgeGraphDocument,
  actions,
} from "../../document-models/knowledge-graph/index.js";
import { useKnowledgeNoteDocumentsInSelectedDrive } from "../../document-models/knowledge-note/index.js";
import type { KnowledgeNoteState } from "../../document-models/knowledge-note/v1/gen/schema/types.js";
import { TOOLBAR_CLASS } from "../shared/theme-context.js";

export default function Editor() {
  const [document, dispatch] = useSelectedKnowledgeGraphDocument();
  const allNoteDocs = useKnowledgeNoteDocumentsInSelectedDrive();

  const state = document.state.global;
  const nodeCount = state.nodes.length;
  const edgeCount = state.edges.length;

  const handleSync = useCallback(() => {
    const docs = allNoteDocs ?? [];
    const noteIds = new Set(docs.map((d) => d.header.id));

    const nodes = docs.map((doc) => ({
      id: generateId(),
      documentId: doc.header.id,
      title: doc.state.global.title ?? doc.header.name ?? null,
      noteType: doc.state.global.noteType ?? null,
      status: (doc.state.global.status as string) ?? "DRAFT",
    }));

    const edges = docs.flatMap((doc) => {
      const links = doc.state.global.links ?? [];
      return links
        .filter((l) => l.targetDocumentId && noteIds.has(l.targetDocumentId))
        .map((link) => ({
          id: generateId(),
          sourceDocumentId: doc.header.id,
          targetDocumentId: link.targetDocumentId ?? "",
          linkType: (link.linkType as string) ?? null,
        }));
    });

    dispatch(
      actions.syncGraph({
        nodes,
        edges,
        syncedAt: new Date().toISOString(),
      }),
    );
  }, [allNoteDocs, dispatch]);

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-4xl">
        <DocumentToolbar className={TOOLBAR_CLASS} />

        <div className="p-6 space-y-6">
          {/* Header */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h1
                  className="text-lg font-bold"
                  style={{ color: "var(--bai-text)" }}
                >
                  Knowledge Graph
                </h1>
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Materialized graph of note relationships, queryable via
                  Switchboard.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSync}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80"
                style={{
                  backgroundColor: "var(--bai-accent)",
                  color: "var(--bai-accent-text)",
                }}
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 2v6h-6M3 12a9 9 0 0115.36-6.36L21 8M3 22v-6h6M21 12a9 9 0 01-15.36 6.36L3 16" />
                </svg>
                Sync Graph
              </button>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div
                className="rounded-lg p-4"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  boxShadow: "0 0 0 1px var(--bai-ring)",
                }}
              >
                <p className="text-2xl font-bold text-emerald-400">
                  {nodeCount}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Nodes
                </p>
              </div>
              <div
                className="rounded-lg p-4"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  boxShadow: "0 0 0 1px var(--bai-ring)",
                }}
              >
                <p className="text-2xl font-bold text-blue-400">{edgeCount}</p>
                <p
                  className="text-xs"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Edges
                </p>
              </div>
              <div
                className="rounded-lg p-4"
                style={{
                  backgroundColor: "var(--bai-bg)",
                  boxShadow: "0 0 0 1px var(--bai-ring)",
                }}
              >
                <p
                  className="text-2xl font-bold"
                  style={{ color: "var(--bai-accent)" }}
                >
                  {state.lastSyncedAt
                    ? new Date(state.lastSyncedAt).toLocaleTimeString()
                    : "\u2014"}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  Last Synced
                </p>
              </div>
            </div>
          </div>

          {/* Nodes list */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h2
              className="mb-3 text-sm font-semibold"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              Nodes ({nodeCount})
            </h2>
            {nodeCount === 0 ? (
              <p className="text-sm" style={{ color: "var(--bai-text-faint)" }}>
                No nodes yet. Click "Sync Graph" to populate from notes.
              </p>
            ) : (
              <div className="space-y-1">
                {state.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs"
                    style={{ backgroundColor: "var(--bai-bg)" }}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        node.status === "CANONICAL"
                          ? "bg-emerald-400"
                          : node.status === "IN_REVIEW"
                            ? "bg-blue-400"
                            : node.status === "ARCHIVED"
                              ? "bg-gray-500"
                              : "bg-amber-400"
                      }`}
                    />
                    <span
                      className="flex-1 truncate"
                      style={{ color: "var(--bai-text-secondary)" }}
                    >
                      {node.title ?? node.documentId}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "var(--bai-hover)",
                        color: "var(--bai-text-muted)",
                      }}
                    >
                      {node.noteType ?? "note"}
                    </span>
                    <span
                      className="font-mono text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {node.documentId.slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edges list */}
          <div
            className="rounded-xl p-6"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <h2
              className="mb-3 text-sm font-semibold"
              style={{ color: "var(--bai-text-tertiary)" }}
            >
              Edges ({edgeCount})
            </h2>
            {edgeCount === 0 ? (
              <p className="text-sm" style={{ color: "var(--bai-text-faint)" }}>
                No edges yet.
              </p>
            ) : (
              <div className="space-y-1">
                {state.edges.map((edge) => {
                  const sourceNode = state.nodes.find(
                    (n) => n.documentId === edge.sourceDocumentId,
                  );
                  const targetNode = state.nodes.find(
                    (n) => n.documentId === edge.targetDocumentId,
                  );
                  return (
                    <div
                      key={edge.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                      style={{ backgroundColor: "var(--bai-bg)" }}
                    >
                      <span
                        className="truncate"
                        style={{ color: "var(--bai-text-secondary)" }}
                      >
                        {sourceNode?.title ?? edge.sourceDocumentId.slice(0, 8)}
                      </span>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                        style={{
                          backgroundColor: "var(--bai-hover)",
                          color: "var(--bai-text-muted)",
                        }}
                      >
                        {edge.linkType ?? "relates to"}
                      </span>
                      <span
                        className="truncate"
                        style={{ color: "var(--bai-text-secondary)" }}
                      >
                        {targetNode?.title ?? edge.targetDocumentId.slice(0, 8)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
