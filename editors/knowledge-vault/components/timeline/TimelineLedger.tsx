import { memo, type ReactNode } from "react";
import type { TimelineAddition } from "../../../../processors/graph-indexer/source-timeline.js";
import { becameLine, clock, countOf, earlierLine, kindWord, progressLine, type DayGroup } from "../../lib/timeline/additions.js";
import type { TimeWords } from "../../lib/timeline/axis.js";
import { formatFileSize } from "../../lib/mime.js";
import { VaultIcon } from "../vault-icons.js";
import { TimelineIcon } from "./timeline-icons.js";

export interface TimelineLedgerProps {
  groups: readonly DayGroup[];
  words?: TimeWords;
  live: string | null;
  selected: string | null;
  hovered: string | null;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  renderDetail: (addition: TimelineAddition) => ReactNode;
}

function Glyph({ a }: { a: TimelineAddition }) {
  switch (a.kind) {
    case "file":
      return /\.epub$/i.test(a.fileName ?? "") || a.mimeType === "application/epub+zip" ? <TimelineIcon name="book" /> : <VaultIcon name="doc" />;
    case "feed":
      return <TimelineIcon name="feed" />;
    case "agent":
      return <TimelineIcon name="agent" />;
    case "written":
      return <VaultIcon name="pencil" />;
    case "imported":
      return <TimelineIcon name="import" />;
    case "unsourced":
      return <VaultIcon name="help" />;
    default:
      return <VaultIcon name="notes" />;
  }
}

const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

interface RowProps {
  a: TimelineAddition;
  open: boolean;
  live: boolean;
  hovered: boolean;
  words?: TimeWords;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
  /** The open row's detail; null for the others, so they stay memoised. */
  detail: ReactNode;
}

/** One addition. Memoised: hovering one row re-renders two rows, not all of them. */
const LedgerRow = memo(function LedgerRow({ a, open, live, hovered, words, onPick, onHover, detail }: RowProps) {
  const progress = progressLine(a, live);
  const earlier = earlierLine(a);
  const pct = a.sources > 0 ? Math.max(1.5, (a.extracted / a.sources) * 100) : 0;
  return (
    <li id={`tl-${a.id}`} className={cls("tl-row", live && "live", open && "open", hovered && "hl")} onPointerEnter={() => onHover(a.id)} onPointerLeave={() => onHover(null)}>
      <span className="tl-when">{clock(Date.parse(a.addedAt), words)}</span>
      <span className="tl-dot">
        <Glyph a={a} />
      </span>
      <div className="tl-body">
        <button type="button" className="tl-rowbtn" aria-expanded={open} onClick={() => onPick(a.id)}>
          <span className="tl-name">{a.title}</span>
          <span className="tl-kind">
            {kindWord(a)}
            {a.sizeBytes ? `, ${formatFileSize(a.sizeBytes)}` : ""}
          </span>
        </button>
        <p className="tl-became">
          {becameLine(a)} {earlier && <span className="tl-earlier">{earlier}</span>}
        </p>
        {progress && (
          <div className={cls("tl-prog", live && "live")}>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${pct.toFixed(1)}%` }} />
            </span>
            <span>{progress}</span>
          </div>
        )}
        {detail}
      </div>
    </li>
  );
});

/** What was added, by day, newest first: one row per addition on a spine. */
export function TimelineLedger(props: TimelineLedgerProps) {
  return (
    <>
      {props.groups.map((g) => (
        <section key={g.key} className="tl-day" aria-label={g.label}>
          <h3 className="tl-dayhead">
            <span>{g.label}</span>
            <small>
              {countOf(g.additions.length, "addition")}, {countOf(g.notes, "note")}
            </small>
          </h3>
          <ol className="tl-list">
            {g.additions.map((a) => {
              const open = props.selected === a.id;
              return (
                <LedgerRow
                  key={a.id}
                  a={a}
                  open={open}
                  live={props.live === a.id}
                  hovered={props.hovered === a.id}
                  words={props.words}
                  onPick={props.onPick}
                  onHover={props.onHover}
                  detail={open ? props.renderDetail(a) : null}
                />
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}
