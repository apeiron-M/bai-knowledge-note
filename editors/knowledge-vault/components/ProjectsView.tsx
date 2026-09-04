import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model/core";
import { useKnowledgeNotes } from "../hooks/use-knowledge-notes.js";
import {
  useReactorDocsWithRefetch,
  type ReactorDocSpec,
} from "../hooks/use-reactor-docs.js";
import { mutateDocumentRemote } from "../lib/remote-reactor.js";
import { triggerVaultPull } from "../hooks/use-remote-first.js";
import { writeSowIntent } from "../../shared/sow-intent.js";

/**
 * The Projects tab.
 *
 * A project is an envelope inside a scope-of-work document
 * (`powerhouse/scopeofwork`): the thing that funds deliverables and links the
 * work breakdown that delivers them. This view lists every envelope of every
 * scope in the drive, grouped by scope; clicking one opens the scope editor
 * at that envelope through the one-shot intent in shared/sow-intent.ts.
 *
 * The execution-link fields (wbsRef / knowledgeRefs / references) are read
 * defensively: scopes written before those fields existed have none.
 */

type EnvelopeRow = {
  id: string;
  sowId: string;
  code: string;
  title: string;
  budget: number | null;
  currency: string | null;
  deliverables: number;
  completed: number;
  knowledgeRefs: number;
  references: number;
  hasWbs: boolean;
  /** projectOwner is an agent id; resolved through the scope's contributors. */
  owner: string | null;
  /** The scope's own DeliverablesSet status for this envelope (DRAFT … FINISHED). */
  setStatus: string;
};

type EnvelopeGroup = { sowId: string; title: string; envelopes: EnvelopeRow[] };

// DeliverableSetStatus, in the vault's chip palette.
const SET_STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  DRAFT: { label: "Draft", fg: "rgba(252, 211, 77, 1)", bg: "rgba(245, 158, 11, 0.15)" },
  TODO: { label: "To do", fg: "var(--bai-text-tertiary)", bg: "rgba(107, 114, 128, 0.15)" },
  IN_PROGRESS: { label: "In progress", fg: "rgba(147, 197, 253, 1)", bg: "rgba(59, 130, 246, 0.15)" },
  FINISHED: { label: "Finished", fg: "rgba(110, 231, 183, 1)", bg: "rgba(52, 211, 153, 0.15)" },
  CANCELED: { label: "Canceled", fg: "var(--bai-text-muted)", bg: "rgba(107, 114, 128, 0.15)" },
};

function formatMoney(amount: number | null, currency: string | null): string {
  // A scope envelope's budget is derived from its deliverables' quotes, so 0 is
  // "nothing quoted yet", not a zero-dollar budget.
  if (amount === null || amount === 0) return "no budget";
  const code = currency ?? "USD";
  // DAI / USDS are not ISO codes; Intl throws on them.
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${code}`;
  }
}

const EnvelopeCard = memo(function EnvelopeCard({ env }: { env: EnvelopeRow }) {
  const setMeta = SET_STATUS_META[env.setStatus] ?? SET_STATUS_META.DRAFT;
  const pct =
    env.deliverables > 0 ? Math.round((env.completed / env.deliverables) * 100) : 0;
  return (
    <button
      type="button"
      onClick={() => {
        writeSowIntent({ documentId: env.sowId, view: { kind: "project", id: env.id } });
        setSelectedNode(env.sowId);
      }}
      className="w-full rounded-xl border border-[var(--bai-border)] bg-[var(--bai-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--bai-accent)] hover:bg-[var(--bai-hover)]"
    >
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
          style={{ backgroundColor: "var(--bai-hover)", color: "var(--bai-text-muted)" }}
        >
          {env.code || "—"}
        </span>
        <p
          className="min-w-0 flex-1 truncate text-sm font-medium"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          {env.title}
        </p>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ color: setMeta.fg, backgroundColor: setMeta.bg }}
        >
          {setMeta.label}
        </span>
        <span className="shrink-0 text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
          {formatMoney(env.budget, env.currency)}
        </span>
      </div>
      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
        style={{ color: "var(--bai-text-muted)" }}
      >
        {env.owner && <span>by {env.owner}</span>}
        <span>
          {env.completed}/{env.deliverables} deliverables
        </span>
        {env.knowledgeRefs > 0 && <span>{env.knowledgeRefs} notes cited</span>}
        {env.references > 0 && <span>{env.references} references</span>}
        <span style={{ color: env.hasWbs ? "var(--bai-text-muted)" : "var(--bai-text-faint)" }}>
          {env.hasWbs ? "has WBS" : "no WBS yet"}
        </span>
      </div>
      {env.deliverables > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--bai-hover)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: "var(--bai-accent)" }}
            />
          </div>
          <span className="text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
            {pct}%
          </span>
        </div>
      )}
    </button>
  );
});

function NewProjectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
      style={{
        backgroundColor: "var(--bai-accent)",
        color: "var(--bai-accent-text)",
      }}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      New project
    </button>
  );
}

function NewProjectDialog({
  open,
  scopes,
  onClose,
}: {
  open: boolean;
  /** The scope-of-work documents an envelope can be added to. */
  scopes: { id: string; title: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setLoading(false);
      setScopeId(scopes[0]?.id ?? "");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, scopes]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // ADD_PROJECT on the chosen scope, then open the scope at that envelope.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = name.trim();
    if (!title || !scopeId || loading) return;
    setLoading(true);
    const id = generateId();
    const code =
      title
        .split(/\s+/)
        .map((w) => w.charAt(0))
        .join("")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .slice(0, 4) || "NEW";
    const slug = `${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}-${id.slice(0, 8)}`;
    try {
      await mutateDocumentRemote(scopeId, [
        { type: "ADD_PROJECT", scope: "global", input: { id, code, title, slug } },
      ]);
      triggerVaultPull();
      onClose();
      writeSowIntent({ documentId: scopeId, view: { kind: "project", id } });
      setSelectedNode(scopeId);
    } catch (err) {
      console.error("[ProjectsView] Failed to add the envelope:", err);
      setLoading(false);
    }
  }

  if (!open) return null;

  const field = {
    backgroundColor: "var(--bai-bg)",
    border: "1px solid var(--bai-border)",
    color: "var(--bai-text)",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="relative z-10 w-[420px] rounded-2xl p-6 shadow-2xl"
        style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
      >
        <h2 className="text-lg font-bold" style={{ color: "var(--bai-text)" }}>
          New project
        </h2>
        <p className="mt-1 text-xs" style={{ color: "var(--bai-text-muted)" }}>
          An envelope inside a scope of work — it funds deliverables and links the work
          breakdown that delivers them.
        </p>

        {scopes.length === 0 ? (
          <p
            className="mt-5 rounded-xl px-4 py-3 text-sm"
            style={{
              backgroundColor: "var(--bai-bg)",
              border: "1px dashed var(--bai-border)",
              color: "var(--bai-text-tertiary)",
            }}
          >
            There is no scope of work in this vault yet. Create one from the Scope tab first.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {scopes.length > 1 ? (
              <select
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={field}
              >
                {scopes.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.title}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
                in <span style={{ color: "var(--bai-text-tertiary)" }}>{scopes[0]?.title}</span>
              </p>
            )}
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name the project…"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={field}
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !scopeId || loading}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: "var(--bai-accent)", color: "var(--bai-accent-text)" }}
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ProjectsView() {
  const [createOpen, setCreateOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = useCallback(
    (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? true) })),
    [],
  );

  const { serverFileNodes, isLoading: treeLoading } = useKnowledgeNotes();
  const specs = useMemo<ReactorDocSpec[]>(
    () =>
      serverFileNodes
        .filter((n) => n.documentType === "powerhouse/scopeofwork")
        .map((n) => ({ id: n.id, documentType: n.documentType, name: n.name })),
    [serverFileNodes],
  );
  const { docs: documents, isLoading: docsLoading } = useReactorDocsWithRefetch(specs, {
    pollMs: 30_000,
    // Switching tabs unmounts this view; `retainKey` paints the scopes the
    // hook already holds while the drive tree reloads.
    retainKey: "projects-view",
  });
  const isLoading = (treeLoading && specs.length === 0) || docsLoading;

  const scopeOptions = useMemo(
    () =>
      documents
        .map((d) => {
          const g = (d.state as unknown as { global: Record<string, unknown> }).global;
          return { id: d.header.id, title: (g.title as string | undefined) || d.header.name };
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    [documents],
  );

  // One group per scope-of-work document; rows are its envelopes.
  const envelopeGroups = useMemo<EnvelopeGroup[]>(() => {
    return documents
      .map((d) => {
        const g = (d.state as unknown as { global: Record<string, unknown> }).global;
        const allDeliverables =
          (g.deliverables as { id: string; status?: string }[] | undefined) ?? [];
        const doneIds = new Set(
          allDeliverables.filter((x) => x.status === "DELIVERED").map((x) => x.id),
        );
        const agentName = new Map(
          ((g.contributors as { id: string; name?: string }[] | undefined) ?? []).map(
            (c) => [c.id, c.name ?? c.id] as const,
          ),
        );
        const envelopes = ((g.projects as Record<string, unknown>[] | undefined) ?? []).map(
          (p) => {
            const scoped =
              (p.scope as { deliverables?: string[] } | null | undefined)?.deliverables ?? [];
            return {
              id: p.id as string,
              sowId: d.header.id,
              code: (p.code as string | undefined) ?? "",
              title: (p.title as string | undefined) || "Untitled envelope",
              budget: typeof p.budget === "number" ? p.budget : null,
              currency: (p.currency as string | undefined) ?? null,
              deliverables: scoped.length,
              completed: scoped.filter((id) => doneIds.has(id)).length,
              knowledgeRefs: ((p.knowledgeRefs as unknown[] | undefined) ?? []).length,
              references: ((p.references as unknown[] | undefined) ?? []).length,
              hasWbs: typeof p.wbsRef === "string" && p.wbsRef.length > 0,
              owner:
                typeof p.projectOwner === "string"
                  ? (agentName.get(p.projectOwner) ?? null)
                  : null,
              setStatus:
                (p.scope as { status?: string } | null | undefined)?.status ?? "DRAFT",
            };
          },
        );
        return {
          sowId: d.header.id,
          title: (g.title as string | undefined) || d.header.name,
          envelopes,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [documents]);
  const total = envelopeGroups.reduce((n, grp) => n + grp.envelopes.length, 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--bai-text-tertiary)" }}>
          Projects ({total})
          {envelopeGroups.length > 0 &&
            ` · ${envelopeGroups.length} scope${envelopeGroups.length === 1 ? "" : "s"} of work`}
        </h2>
        <NewProjectButton onClick={() => setCreateOpen(true)} />
      </div>

      {isLoading && envelopeGroups.length === 0 ? (
        <div
          className="flex h-64 items-center justify-center rounded-xl"
          style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
            Loading projects…
          </p>
        </div>
      ) : total === 0 ? (
        <div
          className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl"
          style={{ backgroundColor: "var(--bai-surface)", border: "1px solid var(--bai-border)" }}
        >
          <div className="text-center">
            <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
              No projects yet
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--bai-text-faint)" }}>
              {envelopeGroups.length === 0
                ? "Create a scope of work first, then add projects inside it"
                : "Add a project to one of your scopes of work"}
            </p>
          </div>
          <NewProjectButton onClick={() => setCreateOpen(true)} />
        </div>
      ) : (
        envelopeGroups.map((grp) => {
          const key = `sow:${grp.sowId}`;
          const isOpen = openGroups[key] ?? true;
          return (
            <div key={grp.sowId}>
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                aria-expanded={isOpen}
                className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-white/5"
                style={{ color: "var(--bai-text-muted)" }}
              >
                <svg
                  className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--bai-accent)" }}
                />
                {grp.title} ({grp.envelopes.length})
                <span
                  className="font-normal normal-case tracking-normal"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  — scope of work
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1">
                  {grp.envelopes.map((env) => (
                    <EnvelopeCard key={env.id} env={env} />
                  ))}
                  {grp.envelopes.length === 0 && (
                    <p className="px-1 text-xs" style={{ color: "var(--bai-text-faint)" }}>
                      No projects in this scope yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      <NewProjectDialog open={createOpen} scopes={scopeOptions} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
