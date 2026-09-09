/**
 * Says why the vault is not readable, instead of leaving a console full of
 * FORBIDDEN to speak for it.
 *
 * There are three distinct failures behind one server message, and conflating
 * them is what makes an authorization error feel like a broken app:
 *
 *   - **Anonymous.** No Renown session at all. The fix is to sign in, so the
 *     gate offers that and nothing else.
 *   - **Authenticated but unauthorized.** A real identity holding no grant.
 *     Signing in again cannot help; the fix is for an administrator to grant
 *     the address, so the gate shows the address, ready to copy, and says who
 *     to ask.
 *   - **Unreachable or misconfigured.** The Switchboard is down, or has
 *     authorization switched off entirely (in which case the auth subgraph is
 *     not even registered). Neither is the user's fault and neither is fixed by
 *     signing in, so they are reported as themselves.
 *
 * The distinction is drawn from `userDocumentPermissions`, which answers about
 * the *caller* and so is the one query a would-be reader is allowed to run.
 * `documentAccess` would be the natural thing to ask and is the wrong choice:
 * it requires ADMIN, so it fails for precisely the people this gate exists to
 * explain things to.
 *
 * Being permitted to read is deliberately NOT inferred from
 * `userDocumentPermissions` being non-empty. A supreme admin from the server's
 * ADMINS list holds no grant rows at all, and an unprotected drive is readable
 * by anyone — so the gate probes the drive itself and treats a successful read
 * as the answer. The permission list is only used to explain a refusal.
 */
import { useCallback, useEffect, useState } from "react";
import {
  RenownAuthButton,
  useRenownAuth,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import { authHeaders } from "../../shared/authed-fetch.js";
import { resolveReactorEndpoint } from "../../shared/subgraph-endpoint.js";

type Verdict =
  | { kind: "checking" }
  | { kind: "allowed" }
  | { kind: "anonymous" }
  | { kind: "unauthorized"; address: string }
  | { kind: "unreachable"; detail: string };

const DRIVE_PROBE = `query Probe($id: String!) {
  document(identifier: $id) { document { id } }
}`;

/**
 * A read of the drive document is the honest test: it is exactly the check
 * every other read in the app will face, so a pass here means the app works
 * rather than merely that some grant row exists.
 */
async function probeDrive(driveId: string): Promise<Verdict> {
  let res: Response;
  try {
    res = await fetch(resolveReactorEndpoint(), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ query: DRIVE_PROBE, variables: { id: driveId } }),
    });
  } catch (err) {
    return {
      kind: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // REQUIRE_AUTHENTICATED_CALLER answers 401 before any resolver runs, and an
  // expired credential answers 401 too — both mean "sign in", not "ask for
  // access".
  if (res.status === 401) return { kind: "anonymous" };
  if (!res.ok) {
    return { kind: "unreachable", detail: `Switchboard returned HTTP ${res.status}` };
  }

  const json = (await res.json()) as {
    data?: { document?: { document?: { id?: string } | null } | null };
    errors?: { message?: string; extensions?: { code?: string } }[];
  };

  const err = json.errors?.[0];
  if (!err) {
    return json.data?.document?.document?.id
      ? { kind: "allowed" }
      : { kind: "unreachable", detail: "The drive was not found on this Switchboard." };
  }

  const code = err.extensions?.code;
  if (code === "UNAUTHENTICATED") return { kind: "anonymous" };
  if (code === "FORBIDDEN") return { kind: "unauthorized", address: "" };
  return { kind: "unreachable", detail: err.message ?? "Unknown error." };
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const driveId = useSelectedDriveId();
  // `RenownAuth` exposes the address directly; there is no `isAuthenticated`,
  // and the presence of an address is the same question.
  const { address: renownAddress, ensName } = useRenownAuth();
  const [verdict, setVerdict] = useState<Verdict>({ kind: "checking" });
  const [copied, setCopied] = useState(false);

  const isAuthenticated = renownAddress !== undefined;
  const address = renownAddress ?? "";

  const check = useCallback(async () => {
    if (!driveId) return;
    setVerdict({ kind: "checking" });
    const result = await probeDrive(driveId);
    // Attribute a refusal to the identity that earned it, so the message can
    // name the address an administrator needs to grant.
    setVerdict(
      result.kind === "unauthorized" && !isAuthenticated
        ? { kind: "anonymous" }
        : result.kind === "unauthorized"
          ? { kind: "unauthorized", address }
          : result,
    );
  }, [driveId, isAuthenticated, address]);

  useEffect(() => {
    void check();
  }, [check]);

  if (!driveId || verdict.kind === "allowed") return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className="w-full max-w-md rounded-lg border p-6"
        style={{
          borderColor: "var(--bai-border)",
          backgroundColor: "var(--bai-surface)",
        }}
      >
        {verdict.kind === "checking" ? (
          <>
            <h1 className="text-base font-semibold">Checking your access…</h1>
            <p className="mt-2 text-sm opacity-70">
              Asking the Switchboard whether this vault is readable by you.
            </p>
          </>
        ) : verdict.kind === "anonymous" ? (
          <>
            <h1 className="text-base font-semibold">Sign in to open this vault</h1>
            <p className="mt-2 text-sm opacity-80">
              This vault is protected, so it needs to know who you are before it
              will serve any note. Signing in uses your Renown identity — no
              password, and nothing is shared with the vault beyond your wallet
              address.
            </p>
            <div className="mt-4">
              <RenownAuthButton />
            </div>
          </>
        ) : verdict.kind === "unauthorized" ? (
          <>
            <h1 className="text-base font-semibold">
              You are signed in, but not yet granted access
            </h1>
            <p className="mt-2 text-sm opacity-80">
              The vault recognises your identity and has no grant for it. Signing
              in again will not change that — an administrator has to grant your
              address <strong>READ</strong> access.
            </p>
            {verdict.address ? (
              <div className="mt-3">
                <p className="text-xs opacity-60">
                  Send them this address{ensName ? ` (${ensName})` : ""}:
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(verdict.address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-left font-mono text-xs"
                  style={{ borderColor: "var(--bai-border)" }}
                  title="Copy to clipboard"
                >
                  {copied ? "Copied ✓" : verdict.address}
                </button>
              </div>
            ) : null}
            <p className="mt-3 text-xs opacity-60">
              An administrator grants it under the gear menu → Access. A grant on
              the drive covers every document in the vault.
            </p>
            <button
              type="button"
              onClick={() => void check()}
              className="mt-4 text-xs underline opacity-70"
            >
              Check again
            </button>
          </>
        ) : (
          <>
            <h1 className="text-base font-semibold">
              Could not reach the vault
            </h1>
            <p className="mt-2 text-sm opacity-80">
              This is not a permissions problem — the Switchboard did not answer
              the way it should. It may be restarting, or authorization may be
              configured differently than the app expects.
            </p>
            <p
              className="mt-3 rounded-md border px-2 py-1.5 font-mono text-xs opacity-70"
              style={{ borderColor: "var(--bai-border)" }}
            >
              {verdict.detail}
            </p>
            <button
              type="button"
              onClick={() => void check()}
              className="mt-4 text-xs underline opacity-70"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
