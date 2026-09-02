import { setSelectedNode } from "@powerhousedao/reactor-browser";
import type { SupersedingNote } from "../../knowledge-vault/lib/supersession.js";

/**
 * The first thing a reader sees on a note the vault no longer holds as
 * current. Superseded: name the successor and the edge's reason, and make
 * it one click away — a stale link should land on the correction, not on a
 * dead end. Archived without a successor: say so, plainly.
 *
 * Deletion would have made both cases invisible; this is why the vault
 * archives and supersedes instead.
 */
export function SupersededBanner({
  status,
  supersededBy,
}: {
  status: string | null;
  supersededBy: SupersedingNote[];
}) {
  const archived = status === "ARCHIVED";
  if (supersededBy.length === 0 && !archived) return null;

  return (
    <div
      role="status"
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        backgroundColor: supersededBy.length
          ? "rgba(250, 179, 135, 0.10)"
          : "var(--bai-hover)",
        border: `1px solid ${supersededBy.length ? "rgba(250, 179, 135, 0.35)" : "var(--bai-border)"}`,
        color: "var(--bai-text-secondary)",
      }}
    >
      {supersededBy.length > 0 ? (
        <div className="space-y-1.5">
          <p className="font-medium" style={{ color: "#fab387" }}>
            Superseded — this claim is no longer the vault&apos;s current
            understanding.
          </p>
          {supersededBy.map((s) => (
            <div key={s.documentId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
                Superseded by
              </span>
              <button
                type="button"
                onClick={() => setSelectedNode(s.documentId)}
                className="text-left text-sm font-medium underline-offset-2 hover:underline"
                style={{ color: "#fab387" }}
              >
                {s.title} →
              </button>
              {s.reason && (
                <span
                  className="basis-full text-xs italic"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  {s.reason}
                </span>
              )}
            </div>
          ))}
          {!archived && (
            <p className="text-xs" style={{ color: "var(--bai-text-faint)" }}>
              Still active: archive it once nothing depends on it.
            </p>
          )}
        </div>
      ) : (
        <p>
          <span className="font-medium">Archived</span> — no longer held as
          current, kept for its history and backlinks. Search skips it.
        </p>
      )}
    </div>
  );
}
