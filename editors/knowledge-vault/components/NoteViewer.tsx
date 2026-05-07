/**
 * Reactor-direct, read-only note viewer.
 *
 * Bypasses Connect's `<DocumentEditorContainer>` and its underlying
 * `KyselyDocumentView`, both of which throw `Document not found` for
 * documents that exist on the server but haven't synced into Connect's
 * local browser-side replica. Instead, we use `useReactorDocs` to
 * fetch the doc state directly from the reactor over GraphQL.
 *
 * Currently displays knowledge-notes, MoCs, and sources in a clean
 * read-only view. Editing isn't supported here yet — when the user
 * needs to edit, they should refresh until Connect's cache catches up
 * (or we wire up a GraphQL mutation dispatcher in a follow-up).
 */
import { useMemo } from "react";
import { useSelectedNode } from "@powerhousedao/reactor-browser";
import {
  useReactorDocs,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import type { DriveFileNode } from "../hooks/use-graph-metadata.js";
import { MarkdownPreview } from "../../shared/markdown-preview.js";

type Props = {
  serverFileNodes: DriveFileNode[];
};

const KNOWN_TYPES = new Set([
  "bai/knowledge-note",
  "bai/moc",
  "bai/source",
]);

export function NoteViewer({ serverFileNodes }: Props) {
  const selectedNode = useSelectedNode();
  const selectedId = selectedNode?.id ?? null;

  const fileNode = useMemo(
    () => serverFileNodes.find((n) => n.id === selectedId) ?? null,
    [serverFileNodes, selectedId],
  );

  const specs: ReactorDocSpec[] = useMemo(() => {
    if (!fileNode) return [];
    return [
      {
        id: fileNode.id,
        documentType: fileNode.documentType,
        name: fileNode.name,
      },
    ];
  }, [fileNode]);

  const docs = useReactorDocs(specs);
  const doc = docs[0];

  if (!selectedId) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--bai-text-faint)" }}
      >
        No note selected.
      </div>
    );
  }

  if (!fileNode) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--bai-text-faint)" }}
      >
        Note <span className="font-mono">{selectedId.slice(0, 8)}</span> not in
        the drive tree yet.
      </div>
    );
  }

  if (!doc) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--bai-text-faint)" }}
      >
        Loading <span className="font-mono">{fileNode.name}</span>…
      </div>
    );
  }

  const state = (doc as unknown as { state: { global: Record<string, unknown> } })
    .state.global;
  const title = (state.title as string | null) ?? fileNode.name;
  const description = state.description as string | null;
  const noteType = state.noteType as string | null;
  const status = state.status as string | null;
  const content = state.content as string | null;
  const topics =
    (state.topics as Array<{ id: string; name: string }> | null) ?? [];
  const links =
    (state.links as Array<{
      id: string;
      targetDocumentId: string | null;
      targetTitle: string | null;
      linkType: string | null;
    }> | null) ?? [];
  const provenance = state.provenance as
    | {
        author: string | null;
        sourceOrigin: string | null;
        createdAt: string | null;
      }
    | null;

  if (!KNOWN_TYPES.has(fileNode.documentType)) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--bai-text-faint)" }}
      >
        Read-only view for <code>{fileNode.documentType}</code> not yet
        implemented.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-6 py-4">
      <div
        className="mx-auto max-w-3xl"
        style={{ color: "var(--bai-text-primary)" }}
      >
        <div
          className="mb-2 flex items-center gap-2 text-[11px] uppercase"
          style={{ color: "var(--bai-text-faint)" }}
        >
          <span>{fileNode.documentType}</span>
          {noteType && <span>· {noteType}</span>}
          {status && <span>· {status}</span>}
        </div>
        <h1 className="mb-3 text-2xl font-semibold">{title}</h1>
        {description && (
          <p
            className="mb-4 text-sm leading-relaxed"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            {description}
          </p>
        )}
        {topics.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <span
                key={t.id}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  backgroundColor: "var(--bai-hover)",
                  color: "var(--bai-accent)",
                }}
              >
                #{t.name}
              </span>
            ))}
          </div>
        )}
        {content && (
          <div className="mb-6">
            <MarkdownPreview content={content} />
          </div>
        )}
        {links.length > 0 && (
          <div className="mb-4">
            <div
              className="mb-2 text-xs uppercase"
              style={{ color: "var(--bai-text-faint)" }}
            >
              Links
            </div>
            <ul className="space-y-1">
              {links.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: "var(--bai-text-secondary)" }}
                >
                  {l.linkType && (
                    <span
                      className="rounded px-1 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: "var(--bai-hover)",
                        color: "var(--bai-text-tertiary)",
                      }}
                    >
                      {l.linkType}
                    </span>
                  )}
                  <span>{l.targetTitle ?? l.targetDocumentId ?? "(missing)"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {provenance && (
          <div
            className="mt-6 border-t pt-3 text-[11px]"
            style={{
              borderColor: "var(--bai-border)",
              color: "var(--bai-text-faint)",
            }}
          >
            {provenance.author && <>by {provenance.author} </>}
            {provenance.sourceOrigin && <>· {provenance.sourceOrigin} </>}
            {provenance.createdAt && (
              <>· {new Date(provenance.createdAt).toLocaleString()}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
