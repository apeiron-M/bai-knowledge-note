import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { isNoteGroup, type SourceTimeline } from "../../../../processors/graph-indexer/source-timeline.js";
import { useMeasuredWidth } from "../../../shared/use-measured.js";
import { clock, dayLabel } from "../../lib/timeline/additions.js";
import { foldedAxis, type TimeWords } from "../../lib/timeline/axis.js";
import { StrataChart } from "../timeline/StrataChart.js";
import { DOCK_CSS, TIMELINE_CSS } from "../timeline/timeline-css.js";
import { TimelineIcon } from "../timeline/timeline-icons.js";
import { countsAt, momentCaption, pickCaption } from "./over-time.js";

export interface TimeDockProps {
  timeline: SourceTimeline;
  now: number;
  words?: TimeWords;
  /** An addition opened from the timeline: its layer lit and its caption shown. */
  pick: string | null;
  /** The track's width, when the caller knows it (tests); otherwise measured. */
  trackWidth?: number;
  /** The moment shown, whenever it changes. */
  onMoment: (t: number) => void;
  onShowEverything: () => void;
  /** The dock's height, whenever it changes — the graph keeps its legend above it. */
  onHeight?: (px: number) => void;
}

/** A whole replay, start to now, across folded time. */
const PLAY_MS = 15_000;
const STEP_MS = 900;
const KEY_STEP = 0.01;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Graph › Over time: drag or play through the vault's history; the graph shows what existed at the moment. */
export function TimeDock(props: TimeDockProps) {
  const { timeline, now, words } = props;
  const track = useRef<HTMLDivElement>(null);
  const measured = useMeasuredWidth(track, props.trackWidth === undefined);
  const width = Math.max(1, Math.floor(props.trackWidth ?? measured));
  const [fraction, setFraction] = useState(1);
  const [playing, setPlaying] = useState(false);
  const dragging = useRef(false);
  // The play loops read and move the head here, so no state updater has to start or stop playing.
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;
  const root = useRef<HTMLDivElement>(null);
  const reportHeight = useRef(props.onHeight);
  reportHeight.current = props.onHeight;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => reportHeight.current?.(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ax = useMemo(() => {
    const times = [
      ...timeline.additions.map((a) => Date.parse(a.addedAt)),
      ...timeline.notes.map((n) => Date.parse(n.addedAt ?? "")),
      ...timeline.topics.map((t) => Date.parse(t.addedAt ?? "")),
    ].filter(Number.isFinite);
    return foldedAxis(times, width, now, { gapPx: 18 });
  }, [timeline, width, now]);
  const arrivals = useMemo(
    () => timeline.additions.filter((a) => !isNoteGroup(a)).map((a) => ax.x(Date.parse(a.addedAt)) / width),
    [timeline, ax, width],
  );
  const atEnd = fraction >= 1;
  const t = atEnd ? now : ax.t(fraction * width);

  const report = useRef(props.onMoment);
  report.current = props.onMoment;
  useEffect(() => report.current(t), [t]);

  useEffect(() => {
    if (!playing) return;
    const moveTo = (next: number) => {
      fractionRef.current = next;
      setFraction(next);
    };
    if (reducedMotion()) {
      // Step from one arrival to the next instead of sweeping.
      const timer = setInterval(() => {
        const next = arrivals.find((x) => x > fractionRef.current + 1e-6);
        moveTo(next ?? 1);
        if (next === undefined) setPlaying(false);
      }, STEP_MS);
      return () => clearInterval(timer);
    }
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const dt = last ? ts - last : 16;
      last = ts;
      const next = Math.min(1, fractionRef.current + dt / PLAY_MS);
      moveTo(next);
      if (next >= 1) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, arrivals]);

  const play = () => {
    if (playing) return setPlaying(false);
    if (atEnd) setFraction(0);
    setPlaying(true);
  };
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return;
    setFraction(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Partial<Record<string, (f: number) => number>> = {
      ArrowRight: (f) => Math.min(1, f + KEY_STEP),
      ArrowLeft: (f) => Math.max(0, f - KEY_STEP),
      Home: () => 0,
      End: () => 1,
    };
    const move = keys[e.key];
    if (move) {
      e.preventDefault();
      setPlaying(false);
      setFraction(move);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      play();
    }
  };

  const caption = (props.pick ? pickCaption(timeline, props.pick) : null) ?? momentCaption(timeline, ax, t, now, words);
  const counts = countsAt(timeline, t);
  const when = atEnd ? "Now" : dayLabel(t, now, words);
  const pct = Math.round(fraction * 100);

  return (
    <div className="tl-dock" role="group" aria-label="The graph over time" ref={root}>
      <style aria-hidden="true">{TIMELINE_CSS + DOCK_CSS}</style>
      {/* Announced: what arrives. The counts change every frame while playing; the slider's value says when. */}
      <span className="tl-sr" aria-live="polite">
        {caption.lead}
      </span>
      <div className="tl-dock-top">
        <p className="tl-dock-caption">
          <span className="lead">{caption.lead}</span> {caption.rest}
        </p>
        {/* Outside the caption, which a narrow dock clamps. */}
        {props.pick && (
          <button type="button" className="tl-dock-all" onClick={props.onShowEverything}>
            Show everything
          </button>
        )}
      </div>
      <div className="tl-dock-row">
        <button type="button" className="tl-play" aria-label={playing ? "Pause" : "Play"} onClick={play}>
          <TimelineIcon name={playing ? "pause" : "play"} size={18} />
        </button>
        <div className="tl-dock-when">
          <b>{when}</b>
          <span>{clock(t, words)}</span>
        </div>
        <div
          className="tl-dock-track"
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Moment shown"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`${when}, ${clock(t, words)}`}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            dragging.current = true;
            setPlaying(false);
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current) fromPointer(e);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
        >
          <StrataChart timeline={timeline} now={now} width={width} height={44} compact words={words} selected={props.pick} label="The vault's notes over time" />
          {arrivals.map((x, i) => (
            <i key={i} className="mark" style={{ left: `${x * 100}%` }} />
          ))}
          <div className="future" style={{ left: `${fraction * 100}%` }} />
          <div className="head" style={{ left: `${fraction * 100}%` }} />
        </div>
        <div className="tl-dock-count">
          <div>
            <b>{counts.notes.toLocaleString("en-US")}</b> {counts.notes === 1 ? "note" : "notes"}
          </div>
          <div>
            <b>{counts.topics.toLocaleString("en-US")}</b> {counts.topics === 1 ? "topic" : "topics"}
          </div>
        </div>
      </div>
    </div>
  );
}
