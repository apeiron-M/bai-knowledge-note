import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedSourceDocument, actions } from "knowledge-note/document-models/source";

const TB = "!bg-[#181825] !border-white/10 [&_button]:!bg-[#1e1e2e] [&_button]:!border-white/10 [&_button:hover]:!bg-[#313244] [&_button_svg]:!text-gray-400 [&_span]:!text-gray-400 [&_h1]:!text-gray-400";
const SOURCE_TYPES = ["ARTICLE", "PAPER", "BOOK_CHAPTER", "TRANSCRIPT", "DOCUMENTATION", "CONVERSATION", "WEB_PAGE", "MANUAL_ENTRY"] as const;
const STATUS_COLORS: Record<string, string> = {
  INBOX: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  EXTRACTING: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  EXTRACTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};
function ts() { return new Date().toISOString(); }

export default function Editor() {
  const [document, dispatch] = useSelectedSourceDocument();
  const state = document.state.global;
  const initialized = !!state.title;

  if (!initialized) {
    return <IngestForm dispatch={dispatch} />;
  }

  const stats = state.extractionStats;

  return (
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TB} />
        <div className="flex gap-6 p-6">
          {/* Main */}
          <div className="min-w-0 flex-1 space-y-5 rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <div className="flex items-center gap-3">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_COLORS[state.status ?? "INBOX"]}`}>{state.status}</span>
              {state.sourceType && <span className="rounded bg-[#313244] px-2 py-0.5 text-xs text-gray-400">{state.sourceType}</span>}
              <select value={state.status ?? "INBOX"}
                onChange={(e) => dispatch(actions.setSourceStatus({ status: e.target.value as "INBOX" | "EXTRACTING" | "EXTRACTED" | "ARCHIVED" }))}
                className="ml-auto rounded border border-white/10 bg-[#1e1e2e] px-2 py-1 text-xs text-gray-400">
                {["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <h1 className="text-2xl font-bold text-gray-100">{state.title}</h1>
            {state.description && <p className="text-sm text-gray-400">{state.description}</p>}

            {/* Content */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Source Content</h3>
              <div className="max-h-[500px] overflow-y-auto rounded-lg border border-white/10 bg-[#11111b] px-4 py-3">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{state.content ?? "No content"}</pre>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-64 shrink-0 space-y-6 self-start rounded-xl bg-[#181825] p-5 ring-1 ring-white/10">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Provenance</h4>
              <div className="space-y-1.5 text-xs text-gray-400">
                {state.provenance?.author && <div className="flex justify-between"><span className="text-gray-600">Author</span><span className="text-gray-300">{state.provenance.author}</span></div>}
                {state.provenance?.url && <div className="flex justify-between"><span className="text-gray-600">URL</span><span className="truncate max-w-[120px] text-gray-300" title={state.provenance.url}>{state.provenance.url}</span></div>}
                {state.provenance?.method && <div className="flex justify-between"><span className="text-gray-600">Method</span><span>{state.provenance.method}</span></div>}
                {state.createdBy && <div className="flex justify-between"><span className="text-gray-600">Ingested by</span><span>{state.createdBy}</span></div>}
              </div>
            </div>

            {stats && (
              <>
                <hr className="border-white/10" />
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Extraction</h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-gray-600">Claims</span><span className="text-emerald-400 font-bold">{stats.claimCount}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Skipped</span><span className="text-gray-400">{stats.skippedCount}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Skip rate</span>
                      <span className={stats.skipRate > 0.1 ? "text-red-400" : "text-emerald-400"}>{(stats.skipRate * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <hr className="border-white/10" />
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Extracted Claims ({(state.extractedClaims ?? []).length})</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(state.extractedClaims ?? []).map((ref, i) => (
                  <p key={i} className="truncate text-[10px] font-mono text-gray-600">{ref}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IngestForm({ dispatch }: { dispatch: (action: ReturnType<typeof actions.ingestSource>) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState<string>("ARTICLE");
  const [desc, setDesc] = useState("");
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");

  return (
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-3xl">
        <DocumentToolbar className={TB} />
        <div className="p-6">
          <div className="rounded-xl bg-[#181825] p-8 ring-1 ring-white/10 space-y-4">
            <h2 className="text-lg font-bold text-gray-100">Ingest Source Material</h2>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Source title"
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Brief description (optional)"
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <div className="grid grid-cols-3 gap-3">
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300">
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author"
                className="rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL (optional)"
                className="rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            </div>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste source content here..." rows={12}
              className="w-full rounded-lg border border-white/10 bg-[#11111b] px-4 py-3 font-mono text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <button type="button" disabled={!title.trim() || !content.trim()}
              onClick={() => dispatch(actions.ingestSource({
                title, content, sourceType: sourceType as "ARTICLE",
                description: desc || undefined, author: author || undefined,
                url: url || undefined, createdAt: ts(),
              }))}
              className="rounded-lg bg-[#cba6f7] px-4 py-2 text-sm font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80 disabled:opacity-40">
              Ingest Source
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
