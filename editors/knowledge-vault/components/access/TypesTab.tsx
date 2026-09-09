/**
 * Access by document type — "this person may write notes, and nothing else".
 *
 * ## Why this is a fan-out and not a setting
 *
 * The host's permission tables have no document-type dimension:
 * `DocumentPermission` is keyed by `(documentId, userAddress)` and
 * `OperationUserPermission` by `(documentId, operationType, userAddress)`.
 * There is no rule engine, so "all knowledge notes" cannot be *stored*. It can
 * only be **materialised** — one row per matching document.
 *
 * That has one consequence the UI must state rather than hide: a document
 * created after the fan-out is NOT covered, because nothing re-evaluates the
 * rule. The same limitation the auth-scope spec records for inherited
 * protection ("a document added to that drive afterwards inherits nothing")
 * applies here, and the honest remedy is to re-apply after a bulk import.
 *
 * ## Why it nonetheless does what you want
 *
 * Grants resolve by looking for a grant of *at least* the required level on the
 * document or any ancestor. So with the drive granting READ to a teammate, a
 * WRITE grant materialised onto every `bai/knowledge-note` gives exactly
 * "can edit notes, read everything else" — the type becomes the boundary even
 * though the model never learns the word.
 */
import { useMemo, useState } from "react";
import {
  ADDRESS_RE,
  Callout,
  Card,
  EmptyState,
  Field,
  GhostButton,
  Hint,
  Inset,
  LEVEL_MEANING,
  LevelSelect,
  PrimaryButton,
  SectionHeader,
  TextInput,
  short,
} from "./parts.js";
import {
  grantDocument,
  revokeDocument,
  type DriveNode,
  type Level,
} from "./use-auth-api.js";

type Progress = { done: number; total: number; failed: number } | null;

function prettyType(t: string): string {
  return t.replace(/^bai\//, "").replace(/^powerhouse\//, "").replace(/-/g, " ");
}

export function TypesTab({
  nodes,
  busy,
  onChanged,
}: {
  nodes: DriveNode[];
  busy: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [level, setLevel] = useState<Level>("WRITE");
  const [progress, setProgress] = useState<Progress>(null);
  const [result, setResult] = useState<string | null>(null);
  const [mode, setMode] = useState<"grant" | "revoke">("grant");

  /** Types actually present in this drive, with counts, commonest first. */
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (n.kind === "folder") continue;
      const t = n.documentType;
      if (!t) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  }, [nodes]);

  const targets = useMemo(
    () =>
      selected
        ? nodes.filter((n) => n.kind !== "folder" && n.documentType === selected)
        : [],
    [nodes, selected],
  );

  const trimmed = address.trim();
  const valid = ADDRESS_RE.test(trimmed);
  const running = progress !== null && progress.done < progress.total;

  async function apply() {
    if (!selected || !valid) return;
    setResult(null);
    setProgress({ done: 0, total: targets.length, failed: 0 });

    let failed = 0;
    // Sequential on purpose: hundreds of parallel mutations against one
    // Switchboard is how you turn an admin action into an outage.
    for (let i = 0; i < targets.length; i++) {
      const res =
        mode === "grant"
          ? await grantDocument(targets[i].id, trimmed, level)
          : await revokeDocument(targets[i].id, trimmed);
      if (res.error) failed += 1;
      setProgress({ done: i + 1, total: targets.length, failed });
    }

    setResult(
      failed === 0
        ? `${mode === "grant" ? "Granted" : "Revoked"} ${short(trimmed)} on all ${targets.length} ${prettyType(selected)} documents.`
        : `Finished with ${failed} failure(s) out of ${targets.length}. The rest were applied — re-run to retry the failures.`,
    );
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Access by document type"
        subtitle="Give someone write access to notes but not to projects, or the reverse. The type becomes the boundary."
      />

      <Callout tone="warn">
        This is applied per document, not stored as a rule — the permission
        tables have no notion of a document type. Documents of this type{" "}
        <strong>created later will not be covered</strong>, so re-apply after a
        bulk import.
      </Callout>

      {types.length === 0 ? (
        <EmptyState title="No documents to group">
          <Hint>
            The drive tree is empty or still loading, so there are no types to
            act on yet.
          </Hint>
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {types.map((t) => {
            const active = selected === t.type;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => {
                  setSelected(t.type);
                  setProgress(null);
                  setResult(null);
                }}
                className="rounded-lg border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: active ? "var(--bai-accent)" : "var(--bai-border)",
                  backgroundColor: active
                    ? "var(--bai-accent-soft)"
                    : "var(--bai-surface)",
                }}
              >
                <span
                  className="block text-xs font-medium capitalize"
                  style={{ color: active ? "var(--bai-accent)" : "var(--bai-text)" }}
                >
                  {prettyType(t.type)}
                </span>
                <span
                  className="block text-[10px] font-mono"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  {t.count} document{t.count === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <Card>
          <SectionHeader
            title={`${targets.length} ${prettyType(selected)} document${targets.length === 1 ? "" : "s"}`}
            subtitle={selected}
          />

          <Inset>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[18rem] flex-1">
                <Field label="Wallet address">
                  <TextInput
                    value={address}
                    onChange={setAddress}
                    placeholder="0x…"
                    mono
                  />
                </Field>
              </div>
              <Field label="Action">
                <div className="flex gap-1">
                  <GhostButton
                    onClick={() => setMode("grant")}
                    disabled={running}
                  >
                    {mode === "grant" ? "● Grant" : "Grant"}
                  </GhostButton>
                  <GhostButton
                    onClick={() => setMode("revoke")}
                    disabled={running}
                    tone="danger"
                  >
                    {mode === "revoke" ? "● Revoke" : "Revoke"}
                  </GhostButton>
                </div>
              </Field>
              {mode === "grant" ? (
                <Field label="Level">
                  <LevelSelect value={level} onChange={setLevel} />
                </Field>
              ) : null}
              <PrimaryButton
                onClick={() => void apply()}
                disabled={busy || running || !valid || targets.length === 0}
              >
                {running
                  ? `${progress.done}/${progress.total}…`
                  : mode === "grant"
                    ? "Apply to all"
                    : "Revoke from all"}
              </PrimaryButton>
            </div>

            {mode === "grant" ? <Hint>{LEVEL_MEANING[level]}</Hint> : null}

            {/* Preview before apply — the exact scale of the change. */}
            {trimmed.length > 0 && !valid ? (
              <Callout tone="danger">
                Not an Ethereum address — expected 0x followed by 40 hex
                characters.
              </Callout>
            ) : valid ? (
              <Callout tone={mode === "revoke" ? "danger" : "info"}>
                {mode === "grant" ? (
                  <>
                    Will write <strong>{targets.length}</strong> grant row
                    {targets.length === 1 ? "" : "s"} giving {short(trimmed)}{" "}
                    <strong>{level}</strong> on every {prettyType(selected)}{" "}
                    document — and on nothing else.
                  </>
                ) : (
                  <>
                    Will remove {short(trimmed)}&apos;s grant from{" "}
                    <strong>{targets.length}</strong> {prettyType(selected)}{" "}
                    document{targets.length === 1 ? "" : "s"}. Access inherited
                    from the drive is unaffected.
                  </>
                )}
              </Callout>
            ) : null}

            {running ? (
              <div className="mt-3">
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--bai-hover)" }}
                >
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${(progress.done / Math.max(progress.total, 1)) * 100}%`,
                      backgroundColor: "var(--bai-accent)",
                    }}
                  />
                </div>
                <Hint>
                  Applied one at a time so a few hundred mutations do not
                  overwhelm the Switchboard.
                </Hint>
              </div>
            ) : null}

            {result ? (
              <Callout tone={result.includes("failure") ? "warn" : "ok"}>
                {result}
              </Callout>
            ) : null}
          </Inset>
        </Card>
      ) : (
        <Hint>Pick a document type above to grant or revoke across it.</Hint>
      )}
    </div>
  );
}
