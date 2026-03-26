import { useState, useCallback } from "react";
import { generateId } from "document-model/core";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { useSelectedMocDocument, actions } from "knowledge-note/document-models/moc";

const TIERS = ["HUB", "DOMAIN", "TOPIC"] as const;
const TIER_COLORS: Record<string, string> = {
  HUB: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  DOMAIN: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  TOPIC: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};
const TB = "!bg-[#181825] !border-white/10 [&_button]:!bg-[#1e1e2e] [&_button]:!border-white/10 [&_button:hover]:!bg-[#313244] [&_button_svg]:!text-gray-400 [&_span]:!text-gray-400 [&_h1]:!text-gray-400";
function ts() { return new Date().toISOString(); }

export default function Editor() {
  const [document, dispatch] = useSelectedMocDocument();
  const state = document.state.global;
  const [newQuestion, setNewQuestion] = useState("");
  const [newIdeaRef, setNewIdeaRef] = useState("");
  const [newIdeaPhrase, setNewIdeaPhrase] = useState("");
  const initialized = !!state.title;

  if (!initialized) {
    return <InitForm dispatch={dispatch} />;
  }

  return (
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-5xl">
        <DocumentToolbar className={TB} />
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <div className="flex items-center gap-3 mb-3">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${TIER_COLORS[state.tier ?? "TOPIC"]}`}>{state.tier}</span>
              <span className="text-xs text-gray-500">{state.noteCount ?? 0} notes</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-100">{state.title}</h1>
            <textarea defaultValue={state.description ?? ""} placeholder="Description..."
              onBlur={(e) => dispatch(actions.updateDescription({ description: e.target.value.trim(), updatedAt: ts() }))}
              className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/50" rows={2} />
          </div>

          {/* Orientation */}
          <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Orientation</h3>
            <textarea defaultValue={state.orientation ?? ""} placeholder="2-3 sentence synthesis..."
              onBlur={(e) => dispatch(actions.updateOrientation({ orientation: e.target.value.trim(), updatedAt: ts() }))}
              className="w-full resize-y rounded-lg border border-white/10 bg-[#11111b] px-4 py-3 text-sm leading-relaxed text-gray-300 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/50" rows={4} />
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Core Ideas */}
            <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Core Ideas ({(state.coreIdeas ?? []).length})</h3>
              <div className="space-y-2">
                {(state.coreIdeas ?? []).map((idea) => (
                  <div key={idea.id} className="group flex items-start gap-2 rounded-lg bg-[#1e1e2e] px-3 py-2 ring-1 ring-white/5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300">{idea.contextPhrase}</p>
                      <p className="text-[10px] font-mono text-gray-600 mt-0.5">{idea.noteRef?.slice(0, 12)}</p>
                    </div>
                    <button type="button" onClick={() => dispatch(actions.removeCoreIdea({ id: idea.id }))}
                      className="text-gray-600 opacity-0 hover:text-red-400 group-hover:opacity-100">&times;</button>
                  </div>
                ))}
                <form className="flex gap-2" onSubmit={(e) => {
                  e.preventDefault(); if (!newIdeaRef.trim() || !newIdeaPhrase.trim()) return;
                  dispatch(actions.addCoreIdea({ id: generateId(), noteRef: newIdeaRef.trim(), contextPhrase: newIdeaPhrase.trim(), sortOrder: (state.coreIdeas ?? []).length, addedAt: ts() }));
                  setNewIdeaRef(""); setNewIdeaPhrase("");
                }}>
                  <input type="text" value={newIdeaRef} onChange={(e) => setNewIdeaRef(e.target.value)} placeholder="Note ID..."
                    className="w-24 rounded border border-white/10 bg-[#11111b] px-2 py-1 text-xs font-mono text-gray-400 outline-none focus:border-[#cba6f7]/50" />
                  <input type="text" value={newIdeaPhrase} onChange={(e) => setNewIdeaPhrase(e.target.value)} placeholder="Why it matters here..."
                    className="flex-1 rounded border border-white/10 bg-[#11111b] px-2 py-1 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50" />
                  <button type="submit" className="rounded bg-[#cba6f7] px-2 py-1 text-xs font-medium text-[#1e1e2e]">Add</button>
                </form>
              </div>
            </div>

            {/* Tensions + Questions */}
            <div className="space-y-6">
              <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Tensions</h3>
                {(state.tensions ?? []).map((t) => (
                  <div key={t.id} className="group flex items-center gap-2 rounded-lg bg-[#1e1e2e] px-3 py-2 ring-1 ring-white/5 mb-1">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    <span className="flex-1 text-xs text-gray-300">{t.description}</span>
                    <button type="button" onClick={() => dispatch(actions.removeTension({ id: t.id }))}
                      className="text-gray-600 opacity-0 hover:text-red-400 group-hover:opacity-100">&times;</button>
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-[#181825] p-6 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Open Questions</h3>
                {(state.openQuestions ?? []).map((q, i) => (
                  <div key={i} className="group flex items-center gap-2 rounded-lg bg-[#1e1e2e] px-3 py-2 ring-1 ring-white/5 mb-1">
                    <span className="flex-1 text-xs text-gray-300">{q}</span>
                    <button type="button" onClick={() => dispatch(actions.removeOpenQuestion({ question: q }))}
                      className="text-gray-600 opacity-0 hover:text-red-400 group-hover:opacity-100">&times;</button>
                  </div>
                ))}
                <form className="flex gap-2 mt-2" onSubmit={(e) => {
                  e.preventDefault(); if (!newQuestion.trim()) return;
                  dispatch(actions.addOpenQuestion({ question: newQuestion.trim() })); setNewQuestion("");
                }}>
                  <input type="text" value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Add question..."
                    className="flex-1 rounded border border-white/10 bg-[#11111b] px-2 py-1 text-xs text-gray-300 outline-none focus:border-[#cba6f7]/50" />
                  <button type="submit" className="rounded bg-[#cba6f7] px-2 py-1 text-xs font-medium text-[#1e1e2e]">Add</button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InitForm({ dispatch }: { dispatch: (action: ReturnType<typeof actions.createMoc>) => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [orient, setOrient] = useState("");
  const [tier, setTier] = useState<string>("TOPIC");
  return (
    <div className="min-h-screen bg-[#1e1e2e] text-gray-200">
      <div className="mx-auto max-w-2xl">
        <DocumentToolbar className={TB} />
        <div className="p-6">
          <div className="rounded-xl bg-[#181825] p-8 ring-1 ring-white/10 space-y-4">
            <h2 className="text-lg font-bold text-gray-100">Create Map of Content</h2>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="MOC Title"
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description"
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <textarea value={orient} onChange={(e) => setOrient(e.target.value)} placeholder="Orientation (2-3 sentences)" rows={3}
              className="w-full rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#cba6f7]/50" />
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#1e1e2e] px-3 py-2 text-sm text-gray-300">
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button type="button" disabled={!title.trim() || !desc.trim() || !orient.trim()}
              onClick={() => dispatch(actions.createMoc({ title, description: desc, orientation: orient, tier: tier as "HUB" | "DOMAIN" | "TOPIC", createdAt: ts() }))}
              className="rounded-lg bg-[#cba6f7] px-4 py-2 text-sm font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80 disabled:opacity-40">
              Create MOC
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
