/**
 * Who signed an operation, and whether the signature checks out.
 *
 * Three honest states: verified (the did:key really produced this
 * signature), unsigned, invalid. The address beside the key is what the
 * signing app CLAIMED to act for — the key↔address binding is a Renown
 * credential this badge does not check, and the tooltip says so.
 */
import type { VerificationResult } from "./verify-signature.js";
import { shortDid } from "./verify-signature.js";

export type SignerInfo = {
  address: string | null;
  app: string | null;
  key: string | null;
};

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export function SignerBadge({
  signer,
  verdict,
  compact = false,
}: {
  signer: SignerInfo | null;
  /** Undefined while the check is still running. */
  verdict: VerificationResult | undefined;
  compact?: boolean;
}) {
  const app = signer?.app ?? null;
  const address = signer?.address ?? null;
  const key = signer?.key ?? null;

  let tone: { color: string; bg: string; glyph: string; label: string };
  let title: string;
  if (!verdict) {
    tone = { color: "var(--bai-text-faint)", bg: "transparent", glyph: "…", label: "checking" };
    title = "Checking signature…";
  } else if (verdict.status === "verified") {
    tone = { color: "#a6e3a1", bg: "rgba(166, 227, 161, 0.12)", glyph: "✓", label: "signed" };
    title = [
      `Signature verified.`,
      `Signed by ${verdict.did}${app ? ` (${app})` : ""}`,
      `at ${verdict.signedAt.toLocaleString()}.`,
      address
        ? `Claims to act for ${address} — that binding is a Renown credential this check does not verify.`
        : "No user address claimed.",
    ].join("\n");
  } else if (verdict.status === "unsigned") {
    tone = { color: "var(--bai-text-faint)", bg: "transparent", glyph: "–", label: "unsigned" };
    title = "This operation carries no signature.";
  } else if (verdict.status === "unsupported") {
    tone = { color: "var(--bai-text-faint)", bg: "transparent", glyph: "?", label: "unverifiable" };
    title = `Cannot verify here: ${verdict.reason}`;
  } else {
    tone = { color: "#f38ba8", bg: "rgba(243, 139, 168, 0.12)", glyph: "✗", label: "invalid" };
    title = `Signature INVALID: ${verdict.reason}`;
  }

  const who =
    app && key
      ? `${app} · ${shortDid(key)}`
      : app ?? (key ? shortDid(key) : null);

  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none"
      style={{ color: tone.color, backgroundColor: tone.bg }}
      title={title}
      aria-label={title}
    >
      <span className="font-semibold">{tone.glyph}</span>
      {!compact && (
        <>
          <span>{tone.label}</span>
          {who && (
            <span className="truncate" style={{ color: "var(--bai-text-tertiary)" }}>
              {who}
            </span>
          )}
          {address && (
            <span className="font-mono" style={{ color: "var(--bai-text-faint)" }}>
              for {shortAddress(address)}
            </span>
          )}
        </>
      )}
    </span>
  );
}
