import { useMemo, useState } from "react";
import type { TensionCloseKind } from "../../shared/tension-intent.js";
import {
  countContradictions,
  foundLine,
  type Claim,
  type Contradiction,
  type ContradictionStatus,
} from "../lib/contradictions.js";
import { prefetchOnHover } from "../lib/prefetch.js";
import { LIBRARY_CSS } from "./library-css.js";
import { LoadingLine } from "./LoadingStates.js";

const FILTERS: { status: ContradictionStatus; label: string }[] = [
  { status: "OPEN", label: "Open" },
  { status: "RESOLVED", label: "Resolved" },
  { status: "DISSOLVED", label: "Dissolved" },
];

const STATUS_WORD: Record<ContradictionStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  DISSOLVED: "Dissolved",
};

/** What the card's footer says while you look at it. */
const STANDING: Record<ContradictionStatus, string> = {
  OPEN: "Until you decide, both claims stand.",
  RESOLVED: "Resolved: one side was right.",
  DISSOLVED: "Dissolved: both hold, in different contexts.",
};

const EMPTY: Record<ContradictionStatus, string> = {
  OPEN: "No open contradictions. When two notes disagree, they show up here.",
  RESOLVED: "Nothing resolved yet. A contradiction you resolve stays here, closed.",
  DISSOLVED: "Nothing dissolved yet. A contradiction you dissolve stays here, closed.",
};

/**
 * The Contradictions place (design: docs/design/vault-view, "Contradictions"):
 * each contradiction as the two notes that disagree, side by side, with the
 * reason recorded on the link between them. Opening one shows today's tension
 * editor; "Resolve…" and "Dissolve…" open it on its closing form.
 */
export function ContradictionsView({
  contradictions,
  isLoading = false,
  onOpen,
  onOpenNote,
}: {
  contradictions: Contradiction[];
  isLoading?: boolean;
  /** Open one in the tension editor, on its closing form when one is named. */
  onOpen: (id: string, closing?: TensionCloseKind) => void;
  /** A claim opens its note; closing the note comes back to the contradiction. */
  onOpenNote: (noteId: string, contradictionId: string) => void;
}) {
  const [filter, setFilter] = useState<ContradictionStatus>("OPEN");
  const counts = useMemo(() => countContradictions(contradictions), [contradictions]);
  const shown = useMemo(
    () => contradictions.filter((c) => c.status === filter),
    [contradictions, filter],
  );
  const loading = isLoading && contradictions.length === 0;
  const now = new Date();

  return (
    <div className="vault-libwrap">
      <style aria-hidden="true">{LIBRARY_CSS}</style>
      <section className="vault-lib" aria-label="Contradictions">
        <div className="lib-head">
          <h1>Contradictions</h1>
          {!loading && <span className="count">{counts.OPEN} open</span>}
        </div>
        <p className="lib-sub">
          When two notes disagree, the vault opens a contradiction. Resolve it when one side is
          right, or dissolve it when both hold in different contexts. Until then, both claims stand.
        </p>

        {loading ? (
          <div className="lib-loading">
            <LoadingLine label="Loading contradictions…" />
          </div>
        ) : (
          <>
            <div className="filters">
              <div className="vault-seg" role="group" aria-label="Show">
                {FILTERS.map(({ status, label }) => (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={filter === status}
                    onClick={() => setFilter(status)}
                  >
                    {label} <span className="c">{counts[status]}</span>
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 ? (
              <div className="calm">{EMPTY[filter]}</div>
            ) : (
              shown.map((c) => (
                <ContradictionCard
                  key={c.id}
                  contradiction={c}
                  found={foundLine(c, now)}
                  onOpen={onOpen}
                  onOpenNote={onOpenNote}
                />
              ))
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ContradictionCard({
  contradiction: c,
  found,
  onOpen,
  onOpenNote,
}: {
  contradiction: Contradiction;
  found: string;
  onOpen: (id: string, closing?: TensionCloseKind) => void;
  onOpenNote: (noteId: string, contradictionId: string) => void;
}) {
  const claim = (item: Claim) => (
    <ClaimCard key={item.id} claim={item} onOpen={() => onOpenNote(item.id, c.id)} />
  );
  return (
    <article className="tcard" aria-label={c.title}>
      <div className="tcard-top">
        <span className="st" data-status={c.status}>
          {STATUS_WORD[c.status]}
        </span>
        <small>{found}</small>
      </div>
      {c.claims.length === 2 ? (
        <div className="vs">
          {claim(c.claims[0])}
          <div className="vs-mid" aria-hidden="true">
            <span>contradicts</span>
          </div>
          {claim(c.claims[1])}
        </div>
      ) : c.claims.length > 0 ? (
        <div className="vs" data-claims="many">
          {c.claims.map(claim)}
        </div>
      ) : (
        <div className="vs" data-claims="many">
          <p className="calm" style={{ margin: 0, padding: "18px 16px" }}>
            {c.title}: no notes are linked to it yet.
          </p>
        </div>
      )}
      {c.why && (
        <p className="tcard-why">
          <b>Why they disagree:</b> {c.why}
        </p>
      )}
      <div className="tcard-acts">
        <span className="grow">{STANDING[c.status]}</span>
        <button type="button" className="btn btn-ghost" onClick={() => onOpen(c.id)} {...prefetchOnHover(c.id)}>
          Open
        </button>
        {c.status === "OPEN" && (
          <>
            <button
              type="button"
              className="btn btn-quiet"
              title="Both can hold, in different contexts"
              onClick={() => onOpen(c.id, "dissolve")}
            >
              Dissolve…
            </button>
            <button
              type="button"
              className="btn btn-primary"
              title="One side is right"
              onClick={() => onOpen(c.id, "resolve")}
            >
              Resolve…
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/** "Decision from 2026 Global Tech Report · in Technology Investment Strategy" */
export function claimMeta(claim: Pick<Claim, "kind" | "source" | "topic">): string {
  const origin = claim.kind
    ? claim.source
      ? `${claim.kind} from ${claim.source}`
      : claim.kind
    : claim.source
      ? `From ${claim.source}`
      : null;
  return [origin, claim.topic ? `in ${claim.topic}` : null].filter(Boolean).join(" · ");
}

function ClaimCard({ claim, onOpen }: { claim: Claim; onOpen: () => void }) {
  if (!claim.exists) {
    return (
      <div className="claim-c" data-dead="">
        <b>{claim.id}</b>
        <span>This note is no longer in the vault.</span>
      </div>
    );
  }
  const meta = claimMeta(claim);
  return (
    <button type="button" className="claim-c" onClick={onOpen} {...prefetchOnHover(claim.id)}>
      <b>{claim.title}</b>
      {claim.description && <span>{claim.description}</span>}
      {meta && <small>{meta}</small>}
    </button>
  );
}
