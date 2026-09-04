import { actions } from "document-models/scope-of-work";
import type { Project } from "document-models/scope-of-work";
import { workBreakdownStructureDocumentType } from "document-models/work-breakdown-structure";
import {
  setSelectedNode,
  useNodesInSelectedDrive,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import { useMemo, useState } from "react";
import { GOAL_STATUS_META, goalRollup } from "../../../shared/project-status.js";
import {
  createDocumentRemote,
  mutateDocumentRemote,
} from "../../../shared/remote-reactor.js";
import { safeUrl } from "../../../shared/sanitize-url.js";
import { useVaultDocIndex } from "../../../shared/use-vault-doc-index.js";
import { triggerVaultPull } from "../../../shared/vault-pull.js";
import { Bar } from "../../components/ui.js";
import { useEditor } from "../../lib/context.js";
import { LinkedWbsReader } from "../../lib/linked-wbs.js";

/*
 * The three sections that make a SoW envelope carry what bai/project used to:
 * the work-breakdown-structure that delivers it, the vault knowledge that
 * informed it, and its external references. Each writes through the SoW's own
 * dispatch (so reducer errors reach the shell banner) using the projects-module
 * operations added for exactly this.
 */

/**
 * `knowledgeRefs` / `references` are non-nullable in the schema, so every
 * envelope created since the fields existed has both arrays — but a scope of
 * work written under the previous schema stores envelopes with neither, and
 * the type-aware linter rightly calls a bare `?? []` dead. The cast is the one
 * place this file admits stored data can predate the schema.
 */
function storedList(p: Project, key: "knowledgeRefs" | "references"): string[] {
  return (p as Partial<Record<typeof key, string[]>>)[key] ?? [];
}

const ALL_GOAL_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "COMPLETED",
  "WONT_DO",
] as const;

/* ── Execution: the WBS ──────────────────────────────────────────────────── */

export function WbsSection({ p }: { p: Project }) {
  const { dispatch, documentId, go } = useEditor();
  const driveId = useSelectedDriveId();
  const rawNodes = useNodesInSelectedDrive();
  const projectsFolderId = rawNodes?.find(
    (n) => n.kind === "folder" && n.name === "projects" && n.parentFolder == null,
  )?.id;
  const existingWbs = useMemo(
    () =>
      (rawNodes ?? [])
        .filter(
          (n) =>
            n.kind === "file" &&
            "documentType" in n &&
            n.documentType === workBreakdownStructureDocumentType,
        )
        .map((n) => ({ id: n.id, name: n.name })),
    [rawNodes],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Link both ways: the envelope points at the WBS, the WBS points back at the
  // SoW document and the envelope inside it (SET_SOW_PROJECT_REF). The back-link
  // goes through the remote-first client because the WBS is another document.
  const linkBothWays = async (wbsId: string) => {
    dispatch(actions.linkProjectWbs({ projectId: p.id, wbsRef: wbsId }));
    await mutateDocumentRemote(wbsId, [
      {
        type: "SET_SOW_PROJECT_REF",
        scope: "global",
        input: { sowRef: documentId, sowProjectId: p.id },
      },
    ]);
  };

  const createWbs = async () => {
    if (!driveId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const newId = await createDocumentRemote({
        documentType: workBreakdownStructureDocumentType,
        name: `${p.title || p.code} — WBS`,
        driveId,
        parentFolderId: projectsFolderId,
        targetFolderPath: "projects",
      });
      triggerVaultPull();
      await linkBothWays(newId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const linkExisting = async (wbsId: string) => {
    if (!wbsId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await linkBothWays(wbsId);
      setPicking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="hd">
        <h2>Execution</h2>
        <span className="muted">the work breakdown structure that delivers this envelope</span>
      </div>
      <LinkedWbsReader wbsRef={p.wbsRef}>
        {({ wbsRef, wbsDoc, goals, missingRef }) => {
          if (missingRef) {
            return (
              <div className="card">
                <div className="err">Linked WBS could not be loaded</div>
                <div className="hint">
                  <span className="mono">{missingRef}</span> does not exist on the server.
                  Create a replacement or link another.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn sm primary" disabled={busy} onClick={() => void createWbs()}>
                    {busy ? "Creating…" : "Create replacement WBS"}
                  </button>
                  <button className="btn sm" onClick={() => setPicking((v) => !v)}>
                    Link existing…
                  </button>
                </div>
                {picking && <WbsPicker options={existingWbs} onPick={(id) => void linkExisting(id)} />}
                {error && <div className="hint err">{error}</div>}
              </div>
            );
          }
          if (!wbsRef) {
            return (
              <div className="card">
                <div className="hint" style={{ padding: 0 }}>
                  No work breakdown structure yet. The WBS holds the goals the team
                  actually works; each deliverable then names the goal that delivers it.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn sm primary" disabled={busy || !driveId} onClick={() => void createWbs()}>
                    {busy ? "Creating…" : "Create WBS"}
                  </button>
                  {existingWbs.length > 0 && (
                    <button className="btn sm" onClick={() => setPicking((v) => !v)}>
                      Link existing…
                    </button>
                  )}
                </div>
                {picking && <WbsPicker options={existingWbs} onPick={(id) => void linkExisting(id)} />}
                {error && <div className="hint err">{error}</div>}
              </div>
            );
          }
          if (!wbsDoc) {
            return <div className="card hint">Loading linked WBS…</div>;
          }
          const rollup = goalRollup(goals);
          const blocked = goals.filter((g) => g.status === "BLOCKED").slice(0, 3);
          return (
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1, fontWeight: 500 }}>{wbsDoc.header.name}</span>
                <span className="muted">
                  {rollup.finished}/{rollup.total} goals · {rollup.pct}%
                </span>
                <button className="btn sm primary" onClick={() => go({ kind: "wbs", projectId: p.id })}>
                  Open work breakdown →
                </button>
                <button className="btn sm ghost" title="Full-page WBS editor" onClick={() => setSelectedNode(wbsRef)}>
                  standalone
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Bar pct={rollup.pct} />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {ALL_GOAL_STATUSES.map((status) => {
                  const count = goals.filter((g) => g.status === status).length;
                  if (count === 0) return null;
                  const meta = GOAL_STATUS_META[status];
                  return (
                    <span
                      key={status}
                      className="chip"
                      style={{ color: meta.fg, background: meta.bg }}
                    >
                      {count} {meta.label}
                    </span>
                  );
                })}
              </div>
              {blocked.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {blocked.map((g) => (
                    <div key={g.id} className="hint" style={{ padding: "2px 0" }}>
                      <span className="tag">blocked</span> {g.description}
                      {g.blockReason ? <span className="faint"> — {g.blockReason}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }}
      </LinkedWbsReader>
    </section>
  );
}

function WbsPicker({
  options,
  onPick,
}: {
  options: { id: string; name: string }[];
  onPick: (id: string) => void;
}) {
  if (options.length === 0) {
    return <div className="hint">No other WBS documents in this drive.</div>;
  }
  return (
    <select
      className="in"
      style={{ marginTop: 10 }}
      defaultValue=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="">Choose a WBS to link…</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/* ── Knowledge: vault notes and maps of content ──────────────────────────── */

const MAX_RESULTS = 8;

export function KnowledgeSection({ p }: { p: Project }) {
  const { dispatch } = useEditor();
  const { knowledgeDocs, byId, isLoading } = useVaultDocIndex();
  const refs = storedList(p, "knowledgeRefs");
  const linked = useMemo(() => new Set(storedList(p, "knowledgeRefs")), [p]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return knowledgeDocs
      .filter((d) => d.title.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
      .map((d) => ({ id: d.id, title: d.title, noteType: d.noteType, already: linked.has(d.id) }));
  }, [knowledgeDocs, query, linked]);

  const add = (ref: string) => {
    dispatch(actions.addProjectKnowledgeRef({ projectId: p.id, ref }));
    setQuery("");
    setAdding(false);
  };
  const remove = (ref: string) =>
    dispatch(actions.removeProjectKnowledgeRef({ projectId: p.id, ref }));

  return (
    <section className="section">
      <div className="hd">
        <h2>Knowledge</h2>
        <span className="muted">
          {refs.length === 0 ? "vault notes and maps that inform this envelope" : `${refs.length} cited from the vault`}
        </span>
      </div>
      <div className="card">
        {refs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {refs.map((ref) => {
              const doc = byId.get(ref);
              return (
                <div key={ref} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="btn ghost sm"
                    style={{ flex: 1, justifyContent: "flex-start", minWidth: 0 }}
                    title="Open in the vault"
                    onClick={() => setSelectedNode(ref)}
                  >
                    <span
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {doc?.title ?? <span className="mono faint">{ref}</span>}
                    </span>
                    {doc?.noteType && <span className="faint mono">{doc.noteType}</span>}
                  </button>
                  <button type="button" className="x" title="Remove citation" onClick={() => remove(ref)}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {adding ? (
          <div style={{ marginTop: refs.length ? 10 : 0 }}>
            <input
              autoFocus
              className="in"
              placeholder={isLoading ? "Loading the vault index…" : "Search notes and maps of content by title…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setAdding(false);
                }
              }}
            />
            {query.trim() && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                {results.length === 0 ? (
                  <div className="hint">No matches</div>
                ) : (
                  results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="btn ghost sm"
                      disabled={r.already}
                      style={{ justifyContent: "space-between" }}
                      onClick={() => add(r.id)}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.title}
                      </span>
                      <span className="faint mono">{r.already ? "cited" : r.noteType ?? ""}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="add" onClick={() => setAdding(true)}>
            + Cite a note or map of content
          </button>
        )}
      </div>
    </section>
  );
}

/* ── References: external URLs ───────────────────────────────────────────── */

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function ReferencesSection({ p }: { p: Project }) {
  const { dispatch } = useEditor();
  const refs = storedList(p, "references");
  const [url, setUrl] = useState("");
  const trimmed = url.trim();
  const invalid = trimmed.length > 0 && !isValidUrl(trimmed);

  // SET_PROJECT_REFERENCES replaces the whole list, like bai/project's SET_REFERENCES.
  const set = (next: string[]) =>
    dispatch(actions.setProjectReferences({ projectId: p.id, references: next }));
  const add = () => {
    if (!trimmed || invalid || refs.includes(trimmed)) return;
    set([...refs, trimmed]);
    setUrl("");
  };

  return (
    <section className="section">
      <div className="hd">
        <h2>References</h2>
        <span className="muted">external links — repositories, deployments, documents</span>
      </div>
      <div className="card">
        {refs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {refs.map((ref) => {
              const href = safeUrl(ref);
              return (
                <div key={ref} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                      style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {ref}
                    </a>
                  ) : (
                    <span className="mono faint" style={{ flex: 1 }} title="Unsafe URL scheme; not linked">
                      {ref}
                    </span>
                  )}
                  <button type="button" className="x" title="Remove" onClick={() => set(refs.filter((r) => r !== ref))}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="in"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <button type="button" className="btn sm primary" disabled={!trimmed || invalid} onClick={add}>
            Add
          </button>
        </div>
        {invalid && <div className="hint err">Must be a valid URL (e.g. https://…)</div>}
      </div>
    </section>
  );
}
