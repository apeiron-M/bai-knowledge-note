/**
 * Who is behind an operation, and whether the signature checks out.
 *
 * Leads with the PERSON: the user address the signing app acted for,
 * shown as their ENS name and avatar when one resolves (same lookup the
 * document toolbar's revision history uses), else the shortened address.
 * Clicking the identity copies the full address — never the ENS name —
 * so it pastes into explorers and allow-lists unchanged.
 *
 * Three honest verification states: verified (the did:key really produced
 * this signature), unsigned, invalid. The key↔address binding is a Renown
 * credential this badge does not check, and the tooltip says so. The key
 * itself and the app name live in the tooltip: they are how the signature
 * is verified, not who the reader is looking for.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ENSAvatar, useEns } from "@powerhousedao/design-system/connect";
import type { VerificationResult } from "./verify-signature.js";
import { shortDid } from "./verify-signature.js";
import {
  identityAvatar,
  identityLabel,
  isHexAddress,
  viaLabel,
} from "./identity.js";

export type SignerInfo = {
  address: string | null;
  app: string | null;
  key: string | null;
};

const COPIED_FEEDBACK_MS = 1_200;

type Tone = { color: string; bg: string; glyph: string; label: string };

function verdictTone(verdict: VerificationResult | undefined): {
  tone: Tone;
  summary: string;
} {
  if (!verdict) {
    return {
      tone: { color: "var(--bai-text-faint)", bg: "transparent", glyph: "…", label: "checking" },
      summary: "Checking signature…",
    };
  }
  switch (verdict.status) {
    case "verified":
      return {
        tone: { color: "#a6e3a1", bg: "rgba(166, 227, 161, 0.12)", glyph: "✓", label: "signed" },
        summary: `Signature verified — signed at ${verdict.signedAt.toLocaleString()}.`,
      };
    case "unsigned":
      return {
        tone: { color: "var(--bai-text-faint)", bg: "transparent", glyph: "–", label: "unsigned" },
        summary: "This operation carries no signature.",
      };
    case "unsupported":
      return {
        tone: { color: "var(--bai-text-faint)", bg: "transparent", glyph: "?", label: "unverifiable" },
        summary: `Cannot verify here: ${verdict.reason}`,
      };
    default:
      return {
        tone: { color: "#f38ba8", bg: "rgba(243, 139, 168, 0.12)", glyph: "✗", label: "invalid" },
        summary: `Signature INVALID: ${verdict.reason}`,
      };
  }
}

/**
 * `[avatar] liberuum.eth` — click to copy the address behind it. Rendered
 * as a span with the button role because it usually sits inside a row that
 * is itself a <button>.
 */
export function IdentityChip({
  address,
  title,
  compact = false,
}: {
  address: string;
  title: string;
  compact?: boolean;
}) {
  const hex = isHexAddress(address) ? address : undefined;
  const { data: ens } = useEns(hex);
  const label = identityLabel(address, ens) ?? address;
  const avatarUrl = identityAvatar(ens) ?? undefined;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Typed non-nullable, but absent in insecure contexts (plain http).
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    if (!clipboard) return;
    void clipboard.writeText(address).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") copy(e);
      }}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-full px-1 py-px transition-colors hover:bg-[var(--bai-hover)]"
      style={{ color: "var(--bai-text-secondary)" }}
      title={`${title}\n\nClick to copy ${address}`}
      aria-label={`${label} — click to copy address ${address}`}
      data-address={address}
    >
      {hex ? (
        <ENSAvatar address={hex} avatarUrl={avatarUrl} size={compact ? "12px" : "14px"} />
      ) : null}
      <span className={copied ? "font-semibold" : "truncate font-mono"}>
        {copied ? "copied" : label}
      </span>
    </span>
  );
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
  const { tone, summary } = verdictTone(verdict);
  const via = viaLabel(app, key, shortDid);

  const title = [
    summary,
    via ? `Signed through ${via}.` : null,
    address
      ? `Acting for ${address} — that key↔address binding is a Renown credential this check does not verify.`
      : "No user address claimed.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] leading-none"
      style={{ color: tone.color, backgroundColor: tone.bg }}
      title={address ? undefined : title}
      aria-label={title}
    >
      <span className="inline-flex items-center gap-1" title={title}>
        <span className="font-semibold">{tone.glyph}</span>
        {!compact && <span>{tone.label}</span>}
      </span>
      {address ? (
        <IdentityChip address={address} title={title} compact={compact} />
      ) : (
        via && !compact && (
          <span className="truncate" style={{ color: "var(--bai-text-tertiary)" }}>
            {via}
          </span>
        )
      )}
      {!compact && address && app && (
        <span className="truncate" style={{ color: "var(--bai-text-faint)" }}>
          via {app}
        </span>
      )}
    </span>
  );
}
