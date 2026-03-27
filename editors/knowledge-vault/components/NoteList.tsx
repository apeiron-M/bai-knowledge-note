import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { CSSProperties } from "react";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";

type NoteListProps = {
  notes: KnowledgeNoteInfo[];
};

const STATUS_BADGE_STYLES: Record<string, CSSProperties> = {
  DRAFT: {
    background: "rgba(245, 158, 11, 0.2)",
    color: "rgba(252, 211, 77, 1)",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  IN_REVIEW: {
    background: "rgba(59, 130, 246, 0.2)",
    color: "rgba(147, 197, 253, 1)",
    borderColor: "rgba(59, 130, 246, 0.3)",
  },
  CANONICAL: {
    background: "rgba(16, 185, 129, 0.2)",
    color: "rgba(110, 231, 183, 1)",
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  ARCHIVED: {
    background: "var(--bai-hover)",
    color: "var(--bai-text-muted)",
    borderColor: "var(--bai-border)",
  },
};

export function NoteList({ notes }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg" style={{ color: "var(--bai-text-muted)" }}>
            No knowledge notes yet
          </p>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--bai-text-faint)" }}
          >
            Create your first note to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function NoteCard({ note }: { note: KnowledgeNoteInfo }) {
  const title = note.title ?? note.name;
  const status = note.status ?? "DRAFT";
  const badgeStyle = STATUS_BADGE_STYLES[status] ?? STATUS_BADGE_STYLES.DRAFT;

  return (
    <button
      type="button"
      onClick={() => setSelectedNode(note.id)}
      className="note-card group flex flex-col rounded-xl border p-4 text-left transition-all"
      style={{
        background: "var(--bai-surface)",
        borderColor: "var(--bai-border)",
      }}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3
          className="note-card-title flex-1 truncate text-sm font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          {title}
        </h3>
        <span
          className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium"
          style={badgeStyle}
        >
          {status.replace("_", " ")}
        </span>
      </div>

      {/* Description */}
      {note.description && (
        <p
          className="mb-3 line-clamp-2 text-xs leading-relaxed"
          style={{ color: "var(--bai-text-muted)" }}
        >
          {note.description}
        </p>
      )}

      {/* Footer: type + topics + links count */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
        {note.noteType && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: "var(--bai-hover)",
              color: "var(--bai-text-muted)",
            }}
          >
            {note.noteType}
          </span>
        )}
        {note.topics.slice(0, 3).map((t) => (
          <span
            key={t.id}
            className="text-[10px]"
            style={{ color: "var(--bai-accent)", opacity: 0.6 }}
          >
            #{t.name}
          </span>
        ))}
        {note.links.length > 0 && (
          <span
            className="ml-auto text-[10px]"
            style={{ color: "var(--bai-text-faint)" }}
          >
            {note.links.length} link{note.links.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Provenance */}
      {note.provenance?.author && (
        <div
          className="mt-2 border-t pt-2 text-[10px]"
          style={{
            borderColor: "var(--bai-border)",
            color: "var(--bai-text-faint)",
          }}
        >
          by {note.provenance.author}
          {note.provenance.updatedAt && (
            <span>
              {" \u00b7 "}
              {new Date(note.provenance.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      <style>{`
        .note-card:hover {
          background: var(--bai-hover) !important;
          border-color: var(--bai-accent) !important;
        }
        .note-card:hover .note-card-title {
          color: var(--bai-accent) !important;
        }
      `}</style>
    </button>
  );
}
