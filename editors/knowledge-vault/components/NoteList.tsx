import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";

type NoteListProps = {
  notes: KnowledgeNoteInfo[];
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  IN_REVIEW: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  CANONICAL: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export function NoteList({ notes }: NoteListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-500">No knowledge notes yet</p>
          <p className="mt-1 text-sm text-gray-600">
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
  const badgeClass = STATUS_BADGE[status] ?? STATUS_BADGE.DRAFT;

  return (
    <button
      type="button"
      onClick={() => setSelectedNode(note.id)}
      className="group flex flex-col rounded-xl border border-white/5 bg-[#1e1e2e] p-4 text-left transition-all hover:border-[#cba6f7]/30 hover:bg-[#1e1e2e]/80"
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="flex-1 truncate text-sm font-semibold text-gray-200 group-hover:text-[#cba6f7]">
          {title}
        </h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}
        >
          {status.replace("_", " ")}
        </span>
      </div>

      {/* Description */}
      {note.description && (
        <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-gray-500">
          {note.description}
        </p>
      )}

      {/* Footer: type + topics + links count */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
        {note.noteType && (
          <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
            {note.noteType}
          </span>
        )}
        {note.topics.slice(0, 3).map((t) => (
          <span
            key={t.id}
            className="text-[10px] text-[#cba6f7]/60"
          >
            #{t.name}
          </span>
        ))}
        {note.links.length > 0 && (
          <span className="ml-auto text-[10px] text-gray-600">
            {note.links.length} link{note.links.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Provenance */}
      {note.provenance?.author && (
        <div className="mt-2 border-t border-white/5 pt-2 text-[10px] text-gray-600">
          by {note.provenance.author}
          {note.provenance.updatedAt && (
            <span>
              {" \u00b7 "}
              {new Date(note.provenance.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
