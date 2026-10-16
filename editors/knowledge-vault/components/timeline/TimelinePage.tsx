import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { SourceTimeline } from "../../../../processors/graph-indexer/source-timeline.js";
import type { TimelineMode } from "../../hooks/use-source-timeline.js";
import {
  countOf,
  dayGroups,
  filterAdditions,
  liveAddition,
  PAGE_ROWS,
  pageGroups,
  ROUTE_LABEL,
  routeCounts,
  summaryParts,
  type Route,
} from "../../lib/timeline/additions.js";
import type { TimeWords } from "../../lib/timeline/axis.js";
import { LoadingPanel } from "../LoadingStates.js";
import { VaultIcon } from "../vault-icons.js";
import { AdditionDetail } from "./AdditionDetail.js";
import { StrataChart } from "./StrataChart.js";
import { TIMELINE_CSS } from "./timeline-css.js";
import { TimelineLedger } from "./TimelineLedger.js";

export interface TimelinePageProps {
  timeline: SourceTimeline | null;
  isLoading: boolean;
  error: Error | null;
  mode: TimelineMode | null;
  now: number;
  words?: TimeWords;
  /** The chart's measured width (px); the container measures `measureRef`. */
  chartWidth: number;
  measureRef?: Ref<HTMLDivElement>;
  initialSelected?: string | null;
  /** The signed-in address, so an addition of theirs reads "by you". */
  me?: string | null;
  onAddSources: () => void;
  /** Opens the vault's paste dialog; the Folders tab offers the same. */
  onPasteText?: () => void;
  onShowInGraph: (additionId: string) => void;
  onOpenSources: (folderId: string) => void;
  onOpenDocument: (documentId: string) => void;
  /** The Notes list narrowed to one addition's notes. */
  onSeeNotes?: (title: string, noteIds: string[]) => void;
}

/** Sources › Timeline: what was added, when, and what each thing became. */
export function TimelinePage(props: TimelinePageProps) {
  const { timeline, now, words } = props;
  const [selected, setSelected] = useState<string | null>(props.initialSelected ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [route, setRoute] = useState<Route | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_ROWS);
  const scrollTo = useRef<string | null>(null);
  // A new filter starts again from the newest page.
  useEffect(() => setLimit(PAGE_ROWS), [route, query]);

  const live = useMemo(() => (timeline ? liveAddition(timeline.additions, now) : null), [timeline, now]);
  const groups = useMemo(
    () => (timeline ? dayGroups(filterAdditions(timeline.additions, route, query), now, words) : []),
    [timeline, route, query, now, words],
  );
  const contributors = useMemo(() => new Set(timeline?.additions.map((a) => a.addedBy).filter(Boolean)).size, [timeline]);
  const page = useMemo(() => pageGroups(groups, limit, selected), [groups, limit, selected]);
  // An addition opened beyond the page widens it for good: closing it must
  // not pull the rows from under the pointer.
  useEffect(() => {
    if (selected && page.rowsShown > limit) setLimit(page.rowsShown);
  }, [selected, page.rowsShown, limit]);

  // A layer clicked in the chart brings its row into view.
  useEffect(() => {
    const id = scrollTo.current;
    if (!id || id !== selected) return;
    scrollTo.current = null;
    document.getElementById(`tl-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const toggle = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);

  let body;
  if (!timeline) {
    body = props.isLoading ? (
      <div style={{ marginTop: 18 }}>
        <LoadingPanel label="Reading the vault's history…" />
      </div>
    ) : props.error ? (
      <div className="calm">
        The timeline could not be read: {props.error.message}. It tries again on its own.
      </div>
    ) : null;
  } else if (timeline.additions.length === 0) {
    body = (
      <div className="tl-empty">
        <svg viewBox="0 0 640 96" aria-hidden="true">
          <line x1="0" y1="78" x2="604" y2="78" stroke="var(--bai-border)" />
          <line x1="604" y1="10" x2="604" y2="78" stroke="var(--bai-accent)" strokeDasharray="3 4" />
          <text x="604" y="94" textAnchor="middle" fill="var(--bai-accent)" fontSize="12" fontWeight="600">
            Now
          </text>
        </svg>
        <h2>Nothing added yet</h2>
        <p>When you add a file, paste some text or follow a feed, it appears here on the day it arrived, with the notes and topics it became.</p>
        <div className="acts">
          <button type="button" className="tl-btn-primary" onClick={props.onAddSources}>
            <VaultIcon name="plus" />
            Add sources
          </button>
          {props.onPasteText && (
            <button type="button" className="vault-btn" onClick={props.onPasteText}>
              Paste text
            </button>
          )}
        </div>
      </div>
    );
  } else {
    const parts = summaryParts(timeline, live, now, words);
    const counts = routeCounts(timeline.additions);
    body = (
      <>
        <p className="tl-sum">{parts.map((p, i) => (p.strong ? <b key={i}>{p.text}</b> : p.text))}</p>
        <section className="tl-panel" aria-label="How the vault grew">
          <div ref={props.measureRef}>
            <StrataChart
              timeline={timeline}
              now={now}
              width={props.chartWidth}
              words={words}
              live={live}
              selected={selected}
              hovered={hovered}
              label={`Notes in the vault over time, in layers by the addition they came from. ${parts.map((p) => p.text).join("")}`}
              onHover={(ids) => setHovered(ids && ids.length === 1 ? ids[0] : null)}
              onPick={(id) => {
                scrollTo.current = id;
                setSelected(id);
              }}
            />
          </div>
          <p className="tl-legend">
            <span>
              <i className="key" />
              Notes, in layers by the addition they came from
            </span>
            <span>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" />
              </svg>
              A topic was started
            </span>
            <span>
              <i className="key fold" />
              Quiet time, folded
            </span>
          </p>
          {props.mode === "browser" && (
            <p className="tl-legend">Note times here are when notes were written, until this vault&apos;s server can say when they arrived.</p>
          )}
        </section>
        <div className="tl-tools" role="toolbar" aria-label="Show additions">
          <button type="button" className="vault-chip" aria-pressed={route === "all"} onClick={() => setRoute("all")}>
            All <span className="n">{timeline.additions.length.toLocaleString("en-US")}</span>
          </button>
          {counts.map(([r, n]) => (
            <button key={r} type="button" className="vault-chip" aria-pressed={route === r} onClick={() => setRoute(r)}>
              {ROUTE_LABEL[r]} <span className="n">{n.toLocaleString("en-US")}</span>
            </button>
          ))}
          <label className="tl-filter">
            <VaultIcon name="search" />
            <input type="search" placeholder="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter additions by name" />
          </label>
        </div>
        {groups.length === 0 ? (
          <div className="calm">Nothing matches. Clear the filter to see every addition.</div>
        ) : (
          <>
          <TimelineLedger
            groups={page.shown}
            words={words}
            live={live}
            selected={selected}
            hovered={hovered}
            onPick={toggle}
            onHover={setHovered}
            renderDetail={(a) => (
              <AdditionDetail
                addition={a}
                timeline={timeline}
                now={now}
                words={words}
                me={props.me ?? null}
                showWho={contributors > 1}
                onShowInGraph={props.onShowInGraph}
                onOpenSources={props.onOpenSources}
                onOpenDocument={props.onOpenDocument}
                onSeeNotes={props.onSeeNotes}
              />
            )}
          />
          {page.hiddenAdditions > 0 && (
            <div className="tl-more">
              <button type="button" className="vault-btn" onClick={() => setLimit((n) => n + PAGE_ROWS)}>
                Show earlier days ({countOf(page.hiddenAdditions, "more addition", "more additions")})
              </button>
            </div>
          )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="vault-tl">
      <style aria-hidden="true">{TIMELINE_CSS}</style>
      <div className="tl-page">
        <div className="tl-head">
          <h2>Sources{timeline ? ` (${timeline.totals.sources.toLocaleString("en-US")})` : ""}</h2>
          <div className="tools">
            {props.onPasteText && (
              <button type="button" className="vault-btn" onClick={props.onPasteText} title="Create a source from text you paste">
                Paste text
              </button>
            )}
            <button type="button" className="tl-btn-primary" onClick={props.onAddSources}>
              <VaultIcon name="plus" />
              Add sources
            </button>
          </div>
        </div>
        {body}
      </div>
    </div>
  );
}
