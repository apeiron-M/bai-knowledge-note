import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SourceTimeline } from "../../../processors/graph-indexer/source-timeline.js";
import type { KnowledgeNoteInfo } from "../hooks/use-knowledge-notes.js";
import type { MocInfo } from "../hooks/use-knowledge-mocs.js";
import {
  KIND_HELP,
  buildNotesIndex,
  needsReview,
  noteMatches,
  rankNotes,
  searchWords,
  type NotesSource,
} from "../lib/notes-view.js";
import { kindLabel, plural, type TreeNodeLike } from "../lib/vault-lookups.js";
import { LIBRARY_CSS } from "./library-css.js";
import { LoadingPanel } from "./LoadingStates.js";
import { VAULT_CONTROLS_CSS } from "./vault-controls-css.js";
import { VaultIcon } from "./vault-icons.js";
import { HowNotesWork, howExample } from "./notes/HowNotesWork.js";
import { NotesMenu, type NotesMenuItem } from "./notes/NotesMenu.js";
import { NOTES_CSS } from "./notes/notes-css.js";
import { NoteRows, type NotesEnv } from "./notes/NoteRow.js";
import { MoreRow, SourceSection, TopicSection, type Disclosure } from "./notes/NotesSections.js";
import {
  howDismissed,
  keepPlace,
  readGrouping,
  recallPlace,
  setHowDismissed,
  writeGrouping,
  type NotesGrouping,
  type NotesOrder,
} from "./notes/notes-memory.js";
import { scrollParent, useLoadMore } from "./notes/use-load-more.js";

/** The list narrowed to some notes: one addition's (Sources › Timeline), or a source or topic picked from Jump to. */
export interface NoteScope {
  label: string;
  ids: ReadonlySet<string>;
  /** A topic reads "in"; a source or an addition "from". */
  kind?: "source" | "topic";
}

type NoteListProps = {
  notes: KnowledgeNoteInfo[];
  mocs?: MocInfo[];
  /** The drive tree: what each note's source is, and its parts. */
  tree?: readonly TreeNodeLike[];
  /** The source timeline: parts in order, kinds, dates. The page works without it. */
  timeline?: SourceTimeline | null;
  /** The vault: what the page remembers is kept per vault. */
  driveId?: string;
  /** True until the first vault metadata fetch settles. */
  isLoading?: boolean;
  /** Sources are being read: an empty vault says so instead of "No notes yet". */
  sourcesBusy?: boolean;
  scope?: NoteScope | null;
  onClearScope?: () => void;
  /** Jump to: show one source's or topic's notes. */
  onScope?: (scope: NoteScope) => void;
  onOpenNote?: (id: string) => void;
  onOpenSource?: (source: NotesSource) => void;
  onOpenTopic?: (id: string) => void;
  /** Graph, with this note or topic selected. */
  onShowInGraph?: (id: string) => void;
  /** Graph › Over time, with this addition lit. */
  onShowAdditionInGraph?: (additionId: string) => void;
  onAddSources?: () => void;
  onPasteText?: () => void;
  onSeeSources?: () => void;
};

/** Notes come 30 at a time (as before); sections three at a time, never split. */
const NOTE_STEP = 30;
const SECTION_STEP = 3;
const NO_MOCS: MocInfo[] = [];
const NO_TREE: TreeNodeLike[] = [];
/** Restoring the scroll before paint; on the server (tests, static render) there is nothing to restore. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The Notes place (design: docs/design/notes-view, option D). Every note sits
 * beside the source it came from, or inside its topic, or in one list; the
 * first visit explains what a note is. More draw as you scroll, and closing a
 * note comes back to the same place.
 */
export function NoteList({
  notes,
  mocs = NO_MOCS,
  tree = NO_TREE,
  timeline = null,
  driveId,
  isLoading = false,
  sourcesBusy = false,
  scope = null,
  onClearScope,
  onScope,
  onOpenNote = setSelectedNode,
  onOpenSource,
  onOpenTopic,
  onShowInGraph,
  onShowAdditionInGraph,
  onAddSources,
  onPasteText,
  onSeeSources,
}: NoteListProps) {
  const index = useMemo(() => buildNotesIndex({ notes, mocs, tree, timeline }), [notes, mocs, tree, timeline]);
  const placeKey = `${driveId ?? ""}|${scope?.label ?? ""}`;
  const [remembered] = useState(() => recallPlace(placeKey));
  const [grouping, setGrouping] = useState<NotesGrouping>(() => readGrouping(driveId));
  const [how, setHow] = useState(() => !howDismissed());
  const [query, setQuery] = useState(remembered?.query ?? "");
  const [review, setReview] = useState(remembered?.review ?? false);
  const [kind, setKind] = useState<string | null>(remembered?.kind ?? null);
  const [order, setOrder] = useState<NotesOrder>(remembered?.order ?? "linked");
  const [batches, setBatches] = useState(remembered?.batches ?? 1);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(remembered?.open ?? []));
  const [peek, setPeek] = useState<string | null>(remembered?.peek ?? null);
  const root = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the place for when the page comes back (a note closed, a place revisited).
  const place = useRef({ query, review, kind, order, batches, open: [...open], peek, scrollTop: remembered?.scrollTop ?? 0 });
  place.current = { ...place.current, query, review, kind, order, batches, open: [...open], peek };
  useEffect(() => {
    const scroller = scrollParent(root.current);
    // Once the page is off, the container scrolls for whatever replaced it: not ours to keep.
    const onScroll = () => {
      if (root.current?.isConnected) place.current.scrollTop = scroller ? scroller.scrollTop : window.scrollY;
    };
    (scroller ?? window).addEventListener("scroll", onScroll, { passive: true });
    return () => (scroller ?? window).removeEventListener("scroll", onScroll);
  }, [placeKey]);
  /** Where the list is scrolled to, now: kept when the page is left, so coming back lands there. */
  const keepHere = useCallback(() => {
    const scroller = scrollParent(root.current);
    place.current.scrollTop = scroller ? scroller.scrollTop : window.scrollY;
    keepPlace(placeKey, place.current);
  }, [placeKey]);
  // Leaving by any route the actions below do not cover: read the scroll before the page comes off.
  useBeforePaint(() => keepHere, [keepHere]);
  const hasNotes = notes.length > 0;
  const restored = useRef(false);
  useBeforePaint(() => {
    if (restored.current || !hasNotes) return;
    restored.current = true;
    const top = remembered?.scrollTop ?? 0;
    if (!top) return;
    const scroller = scrollParent(root.current);
    if (scroller) scroller.scrollTop = top;
    else window.scrollTo(0, top);
  }, [hasNotes, remembered]);

  const words = useMemo(() => searchWords(query), [query]);
  const narrowed = words.length > 0 || review || kind !== null;
  const pool = useMemo(() => (scope ? notes.filter((n) => scope.ids.has(n.id)) : notes), [notes, scope]);
  const matched = useMemo(
    () => new Set(pool.filter((n) => noteMatches(index, n, words) && (!review || needsReview(n)) && (!kind || n.noteType === kind)).map((n) => n.id)),
    [pool, index, words, review, kind],
  );

  const changeGrouping = (g: NotesGrouping) => {
    setGrouping(g);
    writeGrouping(driveId, g);
    setBatches(1);
    setPeek(null);
  };
  const narrow = (apply: () => void) => {
    apply();
    setBatches(1);
    setPeek(null);
  };
  const toTop = useCallback(() => {
    const scroller = scrollParent(root.current);
    const smooth = typeof matchMedia === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    (scroller ?? window).scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }, []);
  const disclosure: Disclosure = useMemo(
    () => ({
      open,
      toggle: (key) =>
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
      setMany: (keys, on) =>
        setOpen((prev) => {
          const next = new Set(prev);
          for (const k of keys) {
            if (on) next.add(k);
            else next.delete(k);
          }
          return next;
        }),
    }),
    [open],
  );

  // What is drawn, in batches.
  const sections = useMemo(() => {
    if (grouping === "source") {
      return index.sources.map((s) => ({ type: "source" as const, key: s.id, ids: s.noteIds.filter((id) => matched.has(id)), total: s.noteIds.length, source: s })).filter((x) => x.ids.length);
    }
    if (grouping === "topic") {
      return index.topics.map((g) => ({ type: "topic" as const, key: g.moc?.id ?? "loose", ids: g.noteIds.filter((id) => matched.has(id)), total: g.noteIds.length, group: g })).filter((x) => x.ids.length);
    }
    return [];
  }, [grouping, index, matched]);
  const flat = useMemo(() => {
    if (grouping !== "all") return [];
    const ids = [...matched];
    if (order === "linked") return rankNotes(index, ids);
    const at = (id: string) => Date.parse(index.byId.get(id)?.provenance?.createdAt ?? "") || 0;
    const title = (id: string) => index.byId.get(id)?.title ?? "";
    return order === "newest" ? ids.sort((a, b) => at(b) - at(a) || title(a).localeCompare(title(b))) : ids.sort((a, b) => title(a).localeCompare(title(b)));
  }, [grouping, matched, order, index]);
  const step = grouping === "all" ? NOTE_STEP : SECTION_STEP;
  const total = grouping === "all" ? flat.length : sections.length;
  const drawn = Math.min(total, batches * step);
  const more = drawn < total;
  useLoadMore(endRef, more, drawn, () => setBatches((b) => b + 1));

  const env: NotesEnv = {
    index,
    words,
    peek,
    togglePeek: (id) => setPeek((p) => (p === id ? null : id)),
    openNote: (id) => {
      keepHere();
      onOpenNote(id);
    },
    showNoteInGraph: onShowInGraph && ((id) => (keepHere(), onShowInGraph(id))),
    openSource: onOpenSource && ((s) => (keepHere(), onOpenSource(s))),
    showSourceInGraph: onShowAdditionInGraph && ((id) => (keepHere(), onShowAdditionInGraph(id))),
    openTopic: onOpenTopic && ((id) => (keepHere(), onOpenTopic(id))),
    // The first section drawn holds the Try on web tour's "Open a note" (its first list's first row).
    tourSection: grouping === "all" ? undefined : sections.at(0)?.key,
  };

  if (isLoading && notes.length === 0) {
    return (
      <div className="p-4">
        <LoadingPanel label="Loading notes…" />
      </div>
    );
  }

  const shell = (children: ReactNode) => (
    <div className="vault-libwrap" ref={root}>
      <style aria-hidden="true">{LIBRARY_CSS}</style>
      {/* Again after the library's button reset, which has the same weight as .vault-btn and .vault-chip and comes later. */}
      <style aria-hidden="true">{VAULT_CONTROLS_CSS}</style>
      <style aria-hidden="true">{NOTES_CSS}</style>
      <section className="vault-lib vault-notes" aria-label="Notes">
        {children}
      </section>
    </div>
  );

  if (notes.length === 0) {
    return shell(
      <>
        <div className="lib-head">
          <h1>Notes</h1>
        </div>
        <div className="vn-empty">
          <h2>{sourcesBusy ? "Your sources are being read" : "No notes yet"}</h2>
          <p>
            {sourcesBusy
              ? "Each idea the vault finds becomes a note here, as it's written."
              : "Notes are written from the sources you add. The vault reads each one, writes a note for every idea it finds, and gathers the notes into topics."}
          </p>
          <div className="vn-acts">
            {sourcesBusy
              ? onSeeSources && (
                  <button type="button" className="btn btn-quiet" onClick={onSeeSources}>
                    <VaultIcon name="sources" size={15} />
                    See progress in Sources
                  </button>
                )
              : (
                  <>
                    {onAddSources && (
                      <button type="button" className="btn btn-primary" onClick={onAddSources}>
                        <VaultIcon name="plus" size={15} />
                        Add sources
                      </button>
                    )}
                    {onPasteText && (
                      <button type="button" className="btn btn-quiet" onClick={onPasteText}>
                        Paste text
                      </button>
                    )}
                  </>
                )}
          </div>
          <HowNotesWork example={null} />
        </div>
      </>,
    );
  }

  const sourceCount = index.sources.filter((s) => s.kind !== "none").length;
  const kinds = new Map<string, number>();
  for (const n of pool) if (n.noteType) kinds.set(n.noteType, (kinds.get(n.noteType) ?? 0) + 1);
  const kindItems: NotesMenuItem[] = [
    { key: "", label: "Every kind", count: pool.length },
    ...[...kinds].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ key: k, label: kindLabel(k) ?? k, count: c, hint: KIND_HELP[k] })),
  ];
  const toReview = pool.filter(needsReview).length;
  const jumpItems: NotesMenuItem[] =
    grouping === "source"
      ? index.sources.map((s) => ({ key: s.id, label: s.name, count: s.noteIds.length, hint: s.label ?? undefined }))
      : index.topics.flatMap((g) => [
          { key: g.moc?.id ?? "loose", label: g.moc?.title ?? "Notes in no topic yet", count: g.noteIds.length, hint: g.subtopics.length ? `A topic area of ${plural(g.subtopics.length, "topic")}` : undefined },
          ...g.subtopics.map((t) => ({ key: t.moc.id, label: t.moc.title, count: t.noteIds.length, indent: true })),
        ]);
  const jump = (key: string) => {
    if (!onScope) return;
    if (grouping === "source") {
      const s = index.sources.find((x) => x.id === key);
      if (s) onScope({ label: s.name, ids: new Set(s.noteIds), kind: "source" });
      return;
    }
    const g = index.topics.find((x) => (x.moc?.id ?? "loose") === key);
    const t = index.topics.flatMap((x) => x.subtopics).find((x) => x.moc.id === key);
    if (g) onScope({ label: g.moc?.title ?? "Notes in no topic yet", ids: new Set(g.noteIds), kind: "topic" });
    else if (t) onScope({ label: t.moc.title, ids: new Set(t.noteIds), kind: "topic" });
  };

  const found = matched.size;
  const counts = [sourceCount > 0 && `came from ${plural(sourceCount, "source")}`, index.topicCount > 0 && `sit in ${plural(index.topicCount, "topic")}`].filter(Boolean).join(" and ");
  let content: ReactNode;
  if (scope && pool.length === 0) {
    content = null;
  } else if (found === 0) {
    content = (
      <div className="vn-none">
        <b>No notes match.</b>
        <br />
        Try fewer words, or{" "}
        <button type="button" className="vn-link" onClick={() => narrow(() => { setQuery(""); setReview(false); setKind(null); })}>
          clear the search and filters
        </button>
        .
      </div>
    );
  } else if (grouping === "all") {
    content = (
      <div className="vn-flat">
        <NoteRows ids={flat.slice(0, drawn)} env={env} context="all" tour />
        <MoreRow endRef={endRef} more={more} loading="Loading more notes…" end={narrowed ? `That's all ${plural(found, "note")} that match.` : `That's all ${plural(found, "note")}.`} onTop={drawn > NOTE_STEP ? toTop : undefined} />
      </div>
    );
  } else {
    const single = sections.length <= 1;
    content = (
      <>
        {sections.slice(0, drawn).map((x) =>
          x.type === "source" ? (
            <SourceSection key={x.key} source={x.source} ids={x.ids} whole={!narrowed && x.ids.length === x.total} env={env} disclosure={disclosure} reviewing={review} onReview={() => narrow(() => setReview(true))} />
          ) : (
            <TopicSection key={x.key} group={x.group} ids={x.ids} whole={!narrowed && x.ids.length === x.total} env={env} disclosure={disclosure} />
          ),
        )}
        <MoreRow
          endRef={endRef}
          more={more}
          loading={grouping === "source" ? "Loading more sources…" : "Loading more topics…"}
          end={single ? null : grouping === "source" ? `That's every source: ${plural(found, "note")}.` : `That's every topic: ${plural(found, "note")}.`}
          onTop={drawn > SECTION_STEP ? toTop : undefined}
        />
      </>
    );
  }

  return shell(
    <>
      <div className="lib-head">
        <h1>Notes</h1>
        <span className="count">{notes.length}</span>
        <div className="vn-tools">
          <label className="vn-search">
            <VaultIcon name="search" size={15} />
            <input type="search" placeholder="Search notes" aria-label="Search notes" value={query} onChange={(e) => narrow(() => setQuery(e.target.value))} />
            {query && (
              <button type="button" className="vn-x" aria-label="Clear the search" onClick={() => narrow(() => setQuery(""))}>
                <VaultIcon name="close" size={13} />
              </button>
            )}
          </label>
          {!how && (
            <button type="button" className="vault-btn" onClick={() => { setHow(true); setHowDismissed(false); }}>
              <VaultIcon name="help" size={15} />
              How notes work
            </button>
          )}
        </div>
      </div>
      <p className="lib-sub">
        Each note is one idea the vault took from a source you added, written as a sentence you can agree or disagree with.
        {counts && ` These ${notes.length} ${counts}.`}
      </p>
      {how && <HowNotesWork example={howExample(index)} onDismiss={() => { setHow(false); setHowDismissed(true); }} />}
      {scope && (
        <div className="vn-scope" role="status">
          <span>
            {pool.length > 0 ? (
              <>
                Showing the <b>{plural(pool.length, "note")}</b> {scope.kind === "topic" ? "in" : "from"} <b>{scope.label}</b>.
              </>
            ) : (
              <>
                No notes from <b>{scope.label}</b> are in the list yet.
              </>
            )}
          </span>
          {onClearScope && (
            <button type="button" className="vault-btn" onClick={onClearScope}>
              Show all notes
            </button>
          )}
        </div>
      )}
      {pool.length > 0 && (
        <div className="vn-ctrl">
          <div className="vault-seg" role="group" aria-label="Group notes">
            {(
              [
                ["source", "By source"],
                ["topic", "By topic"],
                ["all", "All notes"],
              ] as const
            ).map(([g, label]) => (
              <button key={g} type="button" aria-pressed={grouping === g} onClick={() => changeGrouping(g)}>
                {label}
              </button>
            ))}
          </div>
          {grouping === "all" && (
            <div className="vault-seg" role="group" aria-label="Order">
              {(
                [
                  ["linked", "Most linked"],
                  ["newest", "Newest"],
                  ["az", "A to Z"],
                ] as const
              ).map(([o, label]) => (
                <button key={o} type="button" aria-pressed={order === o} onClick={() => narrow(() => setOrder(o))}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="vn-grow" />
          {narrowed && (
            <span className="vn-res">
              <b>{plural(found, "note")}</b>
              {query.trim() ? ` match “${query.trim()}”` : ""}
              {review ? " to review" : ""}
              {kind ? `, ${(kindLabel(kind) ?? kind).toLowerCase()} only` : ""}
            </span>
          )}
          {toReview > 0 && (
            <button type="button" className="vault-chip" aria-pressed={review} onClick={() => narrow(() => setReview((r) => !r))}>
              To review <span className="n">{toReview}</span>
            </button>
          )}
          {grouping !== "all" && onScope && !scope && jumpItems.length > 1 && (
            <NotesMenu label={grouping === "source" ? "Jump to a source" : "Jump to a topic"} items={jumpItems} onPick={jump} />
          )}
          <NotesMenu label={kind ? (kindLabel(kind) ?? kind) : "Every kind"} items={kindItems} checked={kind ?? ""} pressed={kind !== null} onPick={(k) => narrow(() => setKind(k || null))} />
        </div>
      )}
      {content}
    </>,
  );
}
