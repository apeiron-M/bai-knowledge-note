/**
 * Who can read and write this vault.
 *
 * Designed against the Six Minds audit in
 * `docs/superpowers/specs/2026-09-09-vault-authorization-design.md` §7. Three
 * things from that audit are load-bearing here rather than decorative:
 *
 * - **The verdict comes first.** The question an admin arrives with is "is this
 *   vault exposed?", not "list the grants". A grant table as the landing view
 *   answers a question nobody asked, so the exposure banner is the visual
 *   anchor and the table sits beneath it.
 * - **Inheritance is stated, not implied.** Grants are written on the *drive*
 *   and inherit to every document beneath it, which is the whole reason a
 *   team-sized number of rows suffices for 1,000+ documents. That is invisible
 *   in the data, so the UI says it in words.
 * - **The two anxieties get explicit safety nets.** "Did I lock myself out?" is
 *   answered by refusing to revoke your own last admin path. "Is there a deny I
 *   am missing?" is answered by saying out loud that this model is allow-only.
 *
 * Deliberately NOT a copy of `@powerhousedao/auth-editor`: that fires Revoke
 * with no confirmation, has no search or sort, and its group UI queries a
 * `groupPermissions` field that does not exist in this stack version — which
 * makes its whole document-permissions panel fail GraphQL validation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { authHeaders } from "../../shared/authed-fetch.js";
import { resolveAuthEndpoint } from "../../shared/subgraph-endpoint.js";

type Level = "READ" | "WRITE" | "ADMIN";

type Grant = {
  documentId: string;
  userAddress: string;
  permission: Level;
  grantedBy: string;
  createdAt: string;
};

type Protection = {
  documentId: string;
  protected: boolean;
  ownerAddress: string | null;
};

/** READ is view-only; WRITE implies READ; ADMIN implies both and can grant. */
const LEVEL_RANK: Record<Level, number> = { READ: 1, WRITE: 2, ADMIN: 3 };

const LEVEL_COPY: Record<Level, string> = {
  READ: "Can view every note, source and project in the vault.",
  WRITE: "Everything READ allows, plus creating, editing and deleting.",
  ADMIN: "Everything WRITE allows, plus granting and revoking access.",
};

async function authQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(resolveAuthEndpoint(), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) return { error: "Not signed in." };
    if (!res.ok) return { error: `Switchboard returned HTTP ${res.status}.` };
    const json = (await res.json()) as {
      data?: T;
      errors?: { message?: string }[];
    };
    if (json.errors?.length) {
      return { error: json.errors[0]?.message ?? "Request refused." };
    }
    return { data: json.data };
  } catch (err) {
    return {
      error: `Could not reach the Switchboard: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

const MINE_QUERY = `query { userDocumentPermissions { documentId permission } }`;
const ACCESS_QUERY = `query Access($id: String!) {
  documentAccess(documentId: $id) {
    documentId
    permissions { documentId userAddress permission grantedBy createdAt }
  }
}`;
const PROTECTION_QUERY = `query Protection($id: String!) {
  documentProtection(documentId: $id) { documentId protected ownerAddress }
}`;
const GRANT_MUTATION = `mutation Grant($id: String!, $addr: String!, $perm: DocumentPermissionLevel!) {
  grantDocumentPermission(documentId: $id, userAddress: $addr, permission: $perm) {
    documentId userAddress permission
  }
}`;
const REVOKE_MUTATION = `mutation Revoke($id: String!, $addr: String!) {
  revokeDocumentPermission(documentId: $id, userAddress: $addr)
}`;

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function AccessView() {
  const driveId = useSelectedDriveId();

  const [mine, setMine] = useState<Grant[] | null>(null);
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [address, setAddress] = useState("");
  const [level, setLevel] = useState<Level>("READ");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!driveId) return;
    setLoading(true);
    setNotice(null);

    const mineRes = await authQuery<{ userDocumentPermissions: Grant[] }>(
      MINE_QUERY,
    );
    setMine(mineRes.data?.userDocumentPermissions ?? null);

    // Both of these need ADMIN on the drive. A refusal is the normal answer
    // for a reader, not a failure — so it is reported as a state, not an error.
    const [accessRes, protRes] = await Promise.all([
      authQuery<{ documentAccess: { permissions: Grant[] } }>(ACCESS_QUERY, {
        id: driveId,
      }),
      authQuery<{ documentProtection: Protection }>(PROTECTION_QUERY, {
        id: driveId,
      }),
    ]);
    setGrants(accessRes.data?.documentAccess.permissions ?? null);
    setProtection(protRes.data?.documentProtection ?? null);
    setAdminError(accessRes.error ?? null);
    setLoading(false);
  }, [driveId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = grants !== null;

  /**
   * The lockout guard. Revoking the row that carries your own admin path is
   * refused here rather than server-side, because the tables have no such
   * check: a supreme admin from `ADMINS` would survive it, but an address whose
   * only admin path is this grant would not, and there is no recovery through
   * the API afterwards.
   */
  const myAddresses = useMemo(
    () => new Set((mine ?? []).map((g) => g.userAddress.toLowerCase())),
    [mine],
  );

  function wouldLockMeOut(addr: string): boolean {
    const lower = addr.toLowerCase();
    if (!myAddresses.has(lower)) return false;
    const admins = (grants ?? []).filter(
      (g) => LEVEL_RANK[g.permission] >= LEVEL_RANK.ADMIN,
    );
    return admins.length <= 1 && admins[0]?.userAddress.toLowerCase() === lower;
  }

  async function submitGrant() {
    if (!driveId) return;
    const addr = address.trim();
    if (!ADDRESS_RE.test(addr)) {
      setNotice("That is not an Ethereum address (expected 0x + 40 hex).");
      return;
    }
    setBusy(true);
    const res = await authQuery(GRANT_MUTATION, {
      id: driveId,
      addr,
      perm: level,
    });
    setBusy(false);
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice(`${short(addr)} now has ${level} on the whole vault.`);
    setAddress("");
    await load();
  }

  async function revoke(addr: string) {
    if (!driveId) return;
    setBusy(true);
    const res = await authQuery(REVOKE_MUTATION, { id: driveId, addr });
    setBusy(false);
    setConfirming(null);
    setNotice(res.error ?? `Revoked ${short(addr)}.`);
    await load();
  }

  if (!driveId) {
    return <p className="p-6 text-sm opacity-70">No drive selected.</p>;
  }

  const exposed = protection !== null && !protection.protected;

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-6">
      {/* ── The verdict. The visual anchor, per the audit. ───────────── */}
      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: exposed ? "#ef4444" : "var(--bai-border)",
          backgroundColor: exposed ? "#ef444412" : "var(--bai-surface)",
        }}
      >
        <h2 className="text-base font-semibold">
          {loading
            ? "Checking who can reach this vault…"
            : exposed
              ? "⚠ This vault is unprotected"
              : protection?.protected
                ? "This vault is protected"
                : "Protection status unavailable"}
        </h2>
        <p className="mt-1 text-sm opacity-80">
          {exposed ? (
            <>
              Anyone who can reach the Switchboard can read <em>and write</em>{" "}
              every document, because an unprotected document skips the
              permission check entirely. Set <code>DEFAULT_PROTECTION=true</code>{" "}
              once the grants below are in place.
            </>
          ) : protection?.protected ? (
            <>
              Only the addresses listed below — plus any supreme admin in the
              server&apos;s <code>ADMINS</code> list — can read or write it.
            </>
          ) : (
            <>
              Sign in as an administrator to see the protection state. A reader
              is not permitted to inspect it.
            </>
          )}
        </p>
        {protection?.ownerAddress ? (
          <p className="mt-2 text-xs opacity-60">
            Owner {short(protection.ownerAddress)} — an implicit administrator,
            separate from the grants below.
          </p>
        ) : null}
      </section>

      {/* ── My own access: the one thing every signed-in user may read. ── */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">My access</h3>
        {mine === null ? (
          <p className="text-sm opacity-70">
            Not signed in, or the Switchboard has authorization switched off.
          </p>
        ) : mine.length === 0 ? (
          <p className="text-sm opacity-70">
            You hold no grants. If you can still read the vault, you are either a
            supreme admin or the documents are unprotected.
          </p>
        ) : (
          <ul className="text-sm">
            {mine.map((g) => (
              <li key={`${g.documentId}-${g.permission}`} className="py-0.5">
                <strong>{g.permission}</strong>{" "}
                <span className="opacity-60">on {short(g.documentId)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── People. Admin-only. ─────────────────────────────────────── */}
      <section>
        <h3 className="mb-1 text-sm font-semibold">People with access</h3>
        <p className="mb-3 text-xs opacity-60">
          Granted on the drive, so each row applies to <em>every</em> document
          in the vault — permissions inherit down the folder tree. This model is
          allow-only: there is no deny, so removing access means revoking the
          row.
        </p>

        {!isAdmin ? (
          <p className="text-sm opacity-70">
            {adminError ?? "You need ADMIN on this drive to manage access."}
          </p>
        ) : (
          <>
            {grants.length === 0 ? (
              <p className="mb-3 text-sm opacity-70">
                No grants yet — only supreme admins can reach the vault.
              </p>
            ) : (
              <table className="mb-3 w-full text-left text-sm">
                <thead className="opacity-60">
                  <tr>
                    <th className="py-1 font-medium">Address</th>
                    <th className="py-1 font-medium">Level</th>
                    <th className="py-1 font-medium">Granted by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...grants]
                    .sort(
                      (a, b) =>
                        LEVEL_RANK[b.permission] - LEVEL_RANK[a.permission] ||
                        a.userAddress.localeCompare(b.userAddress),
                    )
                    .map((g) => {
                      const locked = wouldLockMeOut(g.userAddress);
                      return (
                        <tr key={g.userAddress} className="border-t">
                          <td className="py-1 font-mono text-xs">
                            {short(g.userAddress)}
                          </td>
                          <td className="py-1">{g.permission}</td>
                          <td className="py-1 font-mono text-xs opacity-60">
                            {short(g.grantedBy)}
                          </td>
                          <td className="py-1 text-right">
                            {confirming === g.userAddress ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void revoke(g.userAddress)}
                                  className="mr-2 text-xs underline"
                                  style={{ color: "#ef4444" }}
                                >
                                  Confirm revoke
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirming(null)}
                                  className="text-xs underline opacity-60"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={locked}
                                title={
                                  locked
                                    ? "This is your only administrator grant. Revoking it would leave nobody able to manage access, and there is no way back through the API."
                                    : undefined
                                }
                                onClick={() => setConfirming(g.userAddress)}
                                className="text-xs underline disabled:no-underline disabled:opacity-40"
                              >
                                {locked ? "Protected" : "Revoke"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x… wallet address"
                spellCheck={false}
                className="min-w-[22rem] flex-1 rounded-md border px-2 py-1 font-mono text-xs"
              />
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as Level)}
                className="rounded-md border px-2 py-1 text-xs"
              >
                <option value="READ">READ</option>
                <option value="WRITE">WRITE</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <button
                type="button"
                disabled={busy || address.trim() === ""}
                onClick={() => void submitGrant()}
                className="rounded-md px-3 py-1 text-xs font-medium disabled:opacity-40"
                style={{
                  backgroundColor: "var(--bai-accent)",
                  color: "var(--bai-accent-contrast, #fff)",
                }}
              >
                {busy ? "Working…" : "Grant"}
              </button>
            </div>
            {/* Just-in-time, at the moment of the decision. */}
            <p className="mt-2 text-xs opacity-60">{LEVEL_COPY[level]}</p>
          </>
        )}
      </section>

      {notice ? (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "var(--bai-border)" }}
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
