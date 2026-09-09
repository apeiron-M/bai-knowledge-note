/**
 * Access — the vault's authorization dashboard, admin-only.
 *
 * Tabs are the audit's microgoal sequence, not a filing scheme: "is anything
 * exposed?" is a different question from "who can see this document?", and only
 * one screen can answer each well. Exposure is the landing tab (Concept A),
 * People and Documents are the working surfaces (Concept B).
 *
 * **Admin-only, and honestly so.** The server already refuses `documentAccess`
 * and every mutation to a non-admin, so this gate is not the control — it
 * exists so a reader gets a sentence instead of a wall of FORBIDDEN. It is
 * derived by asking the server rather than inferred from a grant list, because
 * a supreme admin from the ADMINS env var holds no grant rows at all and would
 * be misclassified by any local check.
 */
import { useCallback, useEffect, useState } from "react";
import { useRenownAuth, useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { AddressChip, Card, Hint, INHERIT_NOTE, Notice } from "./parts.js";
import { ExposureTab } from "./ExposureTab.js";
import { PeopleTab } from "./PeopleTab.js";
import { DocumentsTab } from "./DocumentsTab.js";
import { TypesTab } from "./TypesTab.js";
import {
  documentAccess,
  documentProtection,
  driveNodes,
  grantDocument,
  operationTypes,
  revokeDocument,
  type DriveNode,
  type Grant,
  type Level,
  type Protection,
} from "./use-auth-api.js";

type Tab = "exposure" | "people" | "types" | "documents";

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "exposure", label: "Exposure", hint: "Is anything open?" },
  { key: "people", label: "People", hint: "Who can reach the vault" },
  { key: "types", label: "By type", hint: "Write notes but not projects" },
  { key: "documents", label: "Documents", hint: "One document, and its operations" },
];

export function AccessView() {
  const driveId = useSelectedDriveId();
  const { address } = useRenownAuth();

  const [tab, setTab] = useState<Tab>("exposure");
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [nodes, setNodes] = useState<DriveNode[]>([]);
  const [opsByModel, setOpsByModel] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!driveId) return;
    setLoading(true);

    // `documentAccess` is the admin test: it is ADMIN-gated server-side, so a
    // refusal is the answer rather than an error.
    const access = await documentAccess(driveId);
    const admin = access.data !== undefined;
    setIsAdmin(admin);
    setGrants(access.data?.documentAccess.permissions ?? []);

    if (admin) {
      const [prot, tree, ops] = await Promise.all([
        documentProtection(driveId),
        driveNodes(driveId),
        operationTypes(),
      ]);
      setProtection(prot.data?.documentProtection ?? null);
      setNodes(tree.data ?? []);
      setOpsByModel(ops);
    }
    setLoading(false);
  }, [driveId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!driveId) {
    return <p className="p-6 text-sm opacity-70">No drive selected.</p>;
  }

  if (loading && isAdmin === null) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <span
          role="status"
          aria-label="Loading access settings"
          className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40"
        />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="p-6">
        <Card>
          <h2 className="text-base font-semibold">Access settings are admin-only</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--bai-text-secondary)" }}>
            Managing who can read and write this vault requires <strong>ADMIN</strong>{" "}
            on the drive, or membership of the server&apos;s <code>ADMINS</code>{" "}
            list. You are signed in
            {address ? (
              <>
                {" "}
                as <span className="font-mono text-xs">{address}</span>
              </>
            ) : null}
            , and hold read-level access at most.
          </p>
          <Hint>
            An existing administrator can raise your level here, under People.
          </Hint>
        </Card>
      </div>
    );
  }

  async function apply(
    fn: () => Promise<{ error?: string }>,
    success: string,
  ) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    setNotice(res.error ?? success);
    await load();
  }

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Access</h1>
          <p className="mt-0.5 text-xs" style={{ color: "var(--bai-text-tertiary)" }}>
            Who can read and write this vault, and what they may change.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {address ? <AddressChip address={address} you /> : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: "var(--bai-border)",
              color: "var(--bai-text-secondary)",
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Segmented control: the tabs are the audit's microgoal order, so they
          read as one grouped choice rather than four loose links. */}
      <nav
        className="inline-flex w-fit gap-0.5 rounded-xl border p-1"
        style={{
          borderColor: "var(--bai-border)",
          backgroundColor: "var(--bai-deep)",
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              title={t.hint}
              aria-current={active ? "page" : undefined}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: active ? "var(--bai-surface)" : "transparent",
                color: active ? "var(--bai-accent)" : "var(--bai-text-tertiary)",
                boxShadow: active ? "0 1px 2px rgba(0,0,0,0.25)" : undefined,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "exposure" ? (
        <ExposureTab
          protection={protection}
          grants={grants}
          documentCount={nodes.length}
          driveName="This vault"
        />
      ) : tab === "people" ? (
        <PeopleTab
          grants={grants}
          myAddress={address ?? ""}
          busy={busy}
          onGrant={(addr, level: Level) =>
            void apply(
              () => grantDocument(driveId, addr, level),
              `${addr.slice(0, 10)}… now has ${level} across the vault.`,
            )
          }
          onRevoke={(addr) =>
            void apply(
              () => revokeDocument(driveId, addr),
              `Revoked ${addr.slice(0, 10)}….`,
            )
          }
        />
      ) : tab === "types" ? (
        <TypesTab nodes={nodes} busy={busy} onChanged={() => void load()} />
      ) : (
        <DocumentsTab
          driveId={driveId}
          driveName="This vault (drive)"
          nodes={nodes}
          operationTypesByModel={opsByModel}
          onChanged={() => void load()}
        />
      )}

      <Hint>{INHERIT_NOTE}</Hint>
      {notice ? <Notice>{notice}</Notice> : null}
    </div>
  );
}
