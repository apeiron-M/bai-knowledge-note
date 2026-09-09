/**
 * Goal 2 at document granularity, plus everything the model can express about a
 * single document: protection, ownership, its own grants, and per-operation
 * grants — the "who may create or modify what" surface.
 *
 * Two audit findings are load-bearing in this layout:
 *
 *  - **The inheritance chain is drawn, not implied.** The audit identified
 *    inheritance as the locus of both spatial confusion ("why can they see
 *    this?") and lockout anxiety. A document's protection may come from an
 *    ancestor, so the strip names which one, borrowed from Concept C.
 *  - **The tree is searchable from the first version.** 1,467 nodes is past the
 *    point where scrolling is navigation.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ADDRESS_RE,
  AddressChip,
  Callout,
  Card,
  ConfirmButton,
  EmptyState,
  Field,
  GhostButton,
  Hint,
  Inset,
  LEVEL_MEANING,
  LevelBadge,
  LevelSelect,
  OPERATION_FOOTGUN,
  PrimaryButton,
  Row,
  SearchInput,
  SectionHeader,
  short,
  TextInput,
} from "./parts.js";
import { LEVEL_RANK } from "./use-auth-api.js";
import {
  documentAccess,
  documentProtection,
  grantDocument,
  grantOperation,
  operationPermissions,
  revokeDocument,
  revokeOperation,
  setProtection,
  transferOwnership,
  type DriveNode,
  type Level,
  type OperationGrant,
  type Protection,
} from "./use-auth-api.js";

type Selected = { id: string; name: string; documentType?: string | null };

/** A grant as it actually applies here, with the ancestor that supplies it. */
type EffectiveGrant = {
  userAddress: string;
  permission: Level;
  sourceId: string;
  sourceName: string;
};

/** Walk to the drive, so the strip can name the ancestor that confers state. */
function ancestry(nodes: DriveNode[], id: string): DriveNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: DriveNode[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentFolder ? byId.get(cur.parentFolder) : undefined;
  }
  return chain;
}

export function DocumentsTab({
  driveId,
  driveName,
  nodes,
  operationTypesByModel,
  onChanged,
}: {
  driveId: string;
  driveName: string;
  nodes: DriveNode[];
  operationTypesByModel: Record<string, string[]>;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected>({
    id: driveId,
    name: driveName,
    documentType: "powerhouse/document-drive",
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        (n.documentType ?? "").toLowerCase().includes(q),
    );
  }, [nodes, query]);

  return (
    <div className="flex gap-4" style={{ minHeight: "24rem" }}>
      <div className="flex w-1/3 min-w-[15rem] flex-col gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={`Search ${nodes.length} documents…`}
        />
        <div
          className="flex-1 overflow-y-auto rounded-md border p-1"
          style={{ borderColor: "var(--bai-border)", maxHeight: "26rem" }}
        >
          <TreeRow
            label={driveName}
            hint="drive"
            active={selected.id === driveId}
            onSelect={() =>
              setSelected({
                id: driveId,
                name: driveName,
                documentType: "powerhouse/document-drive",
              })
            }
          />
          {filtered.map((n) => (
            <TreeRow
              key={n.id}
              label={n.name || n.id.slice(0, 8)}
              hint={n.kind === "folder" ? "folder" : (n.documentType ?? "file")}
              active={selected.id === n.id}
              onSelect={() =>
                setSelected({ id: n.id, name: n.name, documentType: n.documentType })
              }
            />
          ))}
          {filtered.length === 0 ? (
            <p className="p-2 text-xs" style={{ color: "var(--bai-text-muted)" }}>
              Nothing matches “{query}”.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: "28rem" }}>
        <DocumentPanel
          key={selected.id}
          selected={selected}
          driveId={driveId}
          driveName={driveName}
          nodes={nodes}
          operationTypesByModel={operationTypesByModel}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

function TreeRow({
  label,
  hint,
  active,
  onSelect,
}: {
  label: string;
  hint: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs"
      style={{
        backgroundColor: active ? "var(--bai-hover)" : "transparent",
        color: active ? "var(--bai-accent)" : "var(--bai-text-secondary)",
      }}
    >
      <span className="truncate">{label}</span>
      <span
        className="shrink-0 text-[10px]"
        style={{ color: "var(--bai-text-faint)" }}
      >
        {hint.replace(/^bai\//, "")}
      </span>
    </button>
  );
}

function DocumentPanel({
  selected,
  driveId,
  driveName,
  nodes,
  operationTypesByModel,
  onChanged,
}: {
  selected: Selected;
  driveId: string;
  driveName: string;
  nodes: DriveNode[];
  operationTypesByModel: Record<string, string[]>;
  onChanged: () => void;
}) {
  const [protection, setProt] = useState<Protection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState("");
  const [level, setLevel] = useState<Level>("READ");
  const [newOwner, setNewOwner] = useState("");
  const [effective, setEffective] = useState<EffectiveGrant[] | null>(null);

  async function load() {
    const [p, a] = await Promise.all([
      documentProtection(selected.id),
      documentAccess(selected.id),
    ]);
    setProt(p.data?.documentProtection ?? null);
    setError(a.error ?? p.error ?? null);

    // Effective access is the union over the inheritance chain, because
    // `#hasGrantInHierarchy` honours a grant sitting on the document OR any
    // ancestor. Reading only this document's own rows is what made a
    // drive-level grant look like nobody had access.
    const chain = [
      { id: driveId, name: driveName },
      ...ancestry(nodes, selected.id).map((n) => ({
        id: n.id,
        name: n.name || n.id.slice(0, 8),
      })),
    ].filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);

    const results = await Promise.all(
      chain.map(async (link) => ({
        link,
        rows:
          link.id === selected.id
            ? (a.data?.documentAccess.permissions ?? [])
            : ((await documentAccess(link.id)).data?.documentAccess.permissions ??
              []),
      })),
    );

    // The highest level anywhere in the chain wins, and we remember where it
    // came from so a row can say whether it is revocable here.
    const merged = new Map<string, EffectiveGrant>();
    for (const { link, rows } of results) {
      for (const row of rows) {
        const key = row.userAddress.toLowerCase();
        const prev = merged.get(key);
        if (!prev || LEVEL_RANK[row.permission] > LEVEL_RANK[prev.permission]) {
          merged.set(key, {
            userAddress: row.userAddress,
            permission: row.permission,
            sourceId: link.id,
            sourceName: link.name,
          });
        }
      }
    }
    setEffective([...merged.values()]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id]);

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) setError(res.error);
    await load();
    onChanged();
  }

  const chain = ancestry(nodes, selected.id);
  const ops = selected.documentType
    ? (operationTypesByModel[selected.documentType] ?? [])
    : [];
  const trimmed = addr.trim();
  const valid = ADDRESS_RE.test(trimmed);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold">{selected.name || selected.id}</h3>
        {/* The inheritance strip, borrowed from Concept C. */}
        <p className="mt-0.5 text-xs" style={{ color: "var(--bai-text-muted)" }}>
          {chain.length > 1
            ? chain.map((n) => n.name || n.id.slice(0, 8)).join(" / ")
            : "at the drive root"}
        </p>
        {selected.documentType ? (
          <p className="text-[10px]" style={{ color: "var(--bai-text-faint)" }}>
            {selected.documentType}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--bai-status-archived)" }}>
          {error}
        </p>
      ) : null}

      {/* ── Protection & ownership ─────────────────────────────── */}
      <Card>
        <SectionHeader title="Protection" />
        <p className="text-sm">
          {protection === null
            ? "unknown"
            : protection.protected
              ? "Protected — grants decide who gets in"
              : "Unprotected — anyone who can reach the Switchboard may read AND write it"}
        </p>
        <Hint>
          A document counts as protected if it or <em>any ancestor</em> is, so
          unprotecting this one may change nothing while a parent stays
          protected.
        </Hint>
        <div className="mt-3">
          {protection?.protected ? (
            <ConfirmButton
              label="Unprotect"
              confirmLabel="Yes, make it open"
              onConfirm={() => void run(() => setProtection(selected.id, false))}
              disabled={busy}
            />
          ) : (
            <GhostButton
              disabled={busy}
              onClick={() => void run(() => setProtection(selected.id, true))}
            >
              Protect
            </GhostButton>
          )}
        </div>

        <div className="mt-5">
          <SectionHeader title="Owner" />
          <p className="mt-1 text-xs">
            {protection?.ownerAddress ? (
              <AddressChip address={protection.ownerAddress} />
            ) : (
              <span style={{ color: "var(--bai-text-muted)" }}>
                none — documents created without a signed-in caller have no owner
              </span>
            )}
          </p>
          <Hint>An owner is an implicit administrator, separate from grants.</Hint>
          <div className="mt-2 flex items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <TextInput
                value={newOwner}
                onChange={setNewOwner}
                placeholder="0x… new owner"
                mono
              />
            </div>
            <ConfirmButton
              label="Transfer"
              confirmLabel="Transfer ownership"
              onConfirm={() => {
                void run(() => transferOwnership(selected.id, newOwner.trim()));
                setNewOwner("");
              }}
              disabled={busy || !ADDRESS_RE.test(newOwner.trim())}
              disabledReason="Enter a valid address first."
            />
          </div>
        </div>
      </Card>

      {/* ── Who has access, including inherited ────────────────── */}
      <Card>
        <SectionHeader
          title="Who has access here"
          subtitle="Includes grants inherited from the drive and any parent folder — that is how access normally reaches a document."
          right={
            effective ? (
              <span
                className="rounded-md px-2 py-1 font-mono text-xs"
                style={{
                  backgroundColor: "var(--bai-hover)",
                  color: "var(--bai-text-tertiary)",
                }}
              >
                {effective.length}
              </span>
            ) : null
          }
        />
        {effective === null ? (
          <Hint>Requires ADMIN of this document to view.</Hint>
        ) : effective.length === 0 ? (
          <EmptyState title="Nobody has an explicit grant">
            <Hint>
              Only supreme admins from the server&apos;s ADMINS list can reach
              it. Those cannot be listed by the API.
            </Hint>
          </EmptyState>
        ) : (
          <div>
            {[...effective]
              .sort(
                (a, b) =>
                  LEVEL_RANK[b.permission] - LEVEL_RANK[a.permission] ||
                  a.userAddress.localeCompare(b.userAddress),
              )
              .map((e) => {
                const here = e.sourceId === selected.id;
                return (
                  <Row key={e.userAddress}>
                    <span className="flex-1">
                      <AddressChip address={e.userAddress} />
                    </span>
                    <LevelBadge level={e.permission} />
                    <span
                      className="w-44 text-right text-[10px]"
                      style={{ color: "var(--bai-text-muted)" }}
                      title={
                        here
                          ? "Granted directly on this document."
                          : `Inherited from ${e.sourceName}. Revoke it there, not here.`
                      }
                    >
                      {here ? "granted here" : `from ${e.sourceName}`}
                    </span>
                    <span className="w-24 text-right">
                      {here ? (
                        <ConfirmButton
                          label="Revoke"
                          confirmLabel="Confirm"
                          onConfirm={() =>
                            void run(() =>
                              revokeDocument(selected.id, e.userAddress),
                            )
                          }
                          disabled={busy}
                        />
                      ) : (
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--bai-text-faint)" }}
                          title={`This grant lives on ${e.sourceName}. Select it in the tree to change it.`}
                        >
                          inherited
                        </span>
                      )}
                    </span>
                  </Row>
                );
              })}
          </div>
        )}

        <Inset className="mt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Field label="Grant on this document only">
                <TextInput value={addr} onChange={setAddr} placeholder="0x…" mono />
              </Field>
            </div>
            <LevelSelect value={level} onChange={setLevel} />
            <PrimaryButton
              onClick={() => {
                void run(() => grantDocument(selected.id, trimmed, level));
                setAddr("");
              }}
              disabled={busy || !valid}
            >
              Grant
            </PrimaryButton>
          </div>
          <Hint>{LEVEL_MEANING[level]}</Hint>
        </Inset>
      </Card>

      {/* ── Per-operation grants ───────────────────────────────── */}
      <OperationsPanel
        documentId={selected.id}
        operations={ops}
        busy={busy}
        onChanged={onChanged}
      />
    </div>
  );
}

/**
 * Who may run one specific operation on this document — the finest control the
 * model has, and the sharpest. `canMutate` treats the existence of any row as a
 * restriction, so the first grant silently locks the operation for everyone
 * else. That is stated at the point of granting, not in docs.
 */
function OperationsPanel({
  documentId,
  operations,
  busy,
  onChanged,
}: {
  documentId: string;
  operations: string[];
  busy: boolean;
  onChanged: () => void;
}) {
  const [op, setOp] = useState("");
  const [rows, setRows] = useState<OperationGrant[] | null>(null);
  const [addr, setAddr] = useState("");
  const [working, setWorking] = useState(false);

  async function load(which: string) {
    if (!which) {
      setRows(null);
      return;
    }
    const res = await operationPermissions(documentId, which);
    setRows(res.data?.operationPermissions.userPermissions ?? null);
  }

  const trimmed = addr.trim();
  const valid = ADDRESS_RE.test(trimmed);
  const restricted = (rows?.length ?? 0) > 0;

  return (
    <Card>
      <SectionHeader
        title="Who can run a specific operation"
        subtitle={OPERATION_FOOTGUN}
      />

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="Operation">
          <input
            list={`ops-${documentId}`}
            value={op}
            onChange={(e) => {
              setOp(e.target.value);
              void load(e.target.value);
            }}
            placeholder={operations[0] ?? "OPERATION_NAME"}
            spellCheck={false}
            className="w-56 rounded-md border px-2 py-1 font-mono text-xs"
            style={{
              borderColor: "var(--bai-border)",
              backgroundColor: "var(--bai-bg)",
              color: "var(--bai-text)",
            }}
          />
        </Field>
        <datalist id={`ops-${documentId}`}>
          {operations.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </div>

      {op && rows !== null ? (
        <>
          <Callout tone={restricted ? "warn" : "ok"}>
            {restricted
              ? `${op} is RESTRICTED — only these ${rows.length} address(es), document admins, and supreme admins may run it.`
              : `${op} is unrestricted — anyone with WRITE here may run it.`}
          </Callout>
          {rows.length > 0 ? (
            <table className="mt-1 w-full text-left text-xs">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userAddress}>
                    <td className="py-1">
                      <AddressChip address={r.userAddress} />
                    </td>
                    <td className="py-1">
                      <span
                        className="mr-1 text-[10px]"
                        style={{ color: "var(--bai-text-muted)" }}
                      >
                        by
                      </span>
                      <AddressChip address={r.grantedBy} />
                    </td>
                    <td className="py-1 text-right">
                      <ConfirmButton
                        label="Revoke"
                        confirmLabel="Confirm"
                        onConfirm={() => {
                          setWorking(true);
                          void revokeOperation(documentId, op, r.userAddress).then(
                            async () => {
                              setWorking(false);
                              await load(op);
                              onChanged();
                            },
                          );
                        }}
                        disabled={busy || working}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <TextInput value={addr} onChange={setAddr} placeholder="0x…" mono />
            </div>
            <PrimaryButton
              onClick={() => {
                setWorking(true);
                void grantOperation(documentId, op, trimmed).then(async () => {
                  setWorking(false);
                  setAddr("");
                  await load(op);
                  onChanged();
                });
              }}
              disabled={busy || working || !valid}
            >
              Allow
            </PrimaryButton>
          </div>
          {valid && !restricted ? (
            <Callout tone="warn">
              This is the first grant for {op}. Applying it restricts {op} to{" "}
              {short(trimmed)} alone — everyone else with WRITE loses the ability
              to run it on this document.
            </Callout>
          ) : null}
        </>
      ) : (
        <Hint>Pick an operation to see who may run it.</Hint>
      )}
    </Card>
  );
}
