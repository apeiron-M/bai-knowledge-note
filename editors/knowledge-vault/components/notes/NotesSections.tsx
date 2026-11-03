import type { CSSProperties, ReactNode, RefObject } from "react";
import {
  UNSOURCED,
  crossSourceLinks,
  keyIdeas,
  needsReview,
  rankNotes,
  sourcesOf,
  topicsFed,
  type NotesSource,
  type NotesTopicGroup,
} from "../../lib/notes-view.js";
import { plural } from "../../lib/vault-lookups.js";
import { VaultIcon, type VaultIconName } from "../vault-icons.js";
import { NoteRows, highlight, type NotesEnv } from "./NoteRow.js";

/** Chapters and subtopics opened in place, by key; shared by every section. */
export type Disclosure = { open: ReadonlySet<string>; toggle: (key: string) => void; setMany: (keys: readonly string[], open: boolean) => void };

const sourceIcon = (s: NotesSource): VaultIconName => (s.label === "Book" ? "book" : s.label === "Email" ? "mail" : "doc");

function day(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const sameYear = at.getFullYear() === new Date().getFullYear();
  return at.toLocaleDateString(undefined, sameYear ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
}

/** "Added September 16", or the span a source kept arriving over. */
function addedLine(s: NotesSource): string | null {
  const first = day(s.addedAt);
  const last = day(s.lastAddedAt);
  if (!first) return null;
  return last && last !== first ? `Added ${first} to ${last}` : `Added ${first}`;
}

function Bars({ items, of }: { items: { key: string; label: string; count: number; icon?: VaultIconName }[]; of: "topics" | "sources" }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const shown = items.slice(0, 6);
  return (
    <ul className="vn-fed" data-of={of}>
      {shown.map((i) => (
        <li key={i.key}>
          {i.icon ? <VaultIcon name={i.icon} size={13} /> : <span className="vn-dia" aria-hidden="true" />}
          <span>{i.label}</span>
          <span className="vn-n">{i.count}</span>
          <span className="vn-bar" style={{ "--w": `${Math.max(4, Math.round((i.count / max) * 100))}%` } as CSSProperties} aria-hidden="true" />
        </li>
      ))}
      {items.length > shown.length && (
        <li className="vn-more">
          <span />
          <span>and {plural(items.length - shown.length, of === "topics" ? "more topic" : "more source")}</span>
        </li>
      )}
    </ul>
  );
}

function Section({ label, margin, children }: { label: string; margin: ReactNode; children: ReactNode }) {
  return (
    <section className="vn-sec" aria-label={label}>
      <header className="vn-margin">{margin}</header>
      <div className="vn-body">{children}</div>
    </section>
  );
}

/** A disclosure row: a chapter, a subtopic, or the rest of a group. */
function Fold({ id, title, count, dia, disclosure, children }: { id: string; title: string; count?: number; dia?: boolean; disclosure: Disclosure; children: ReactNode }) {
  const open = disclosure.open.has(id);
  return (
    <li className="vn-ch">
      <button type="button" aria-expanded={open} onClick={() => disclosure.toggle(id)}>
        <VaultIcon name="right" size={15} />
        <span className="vn-t">
          {dia && <span className="vn-dia" aria-hidden="true" />}
          <span>{title}</span>
        </span>
        <span className="vn-n">{count !== undefined ? plural(count, "note") : ""}</span>
      </button>
      {open && children}
    </li>
  );
}

const KEY_HINT = <small>its most connected notes</small>;

/** A narrowed section shows its most connected matches first; the rest wait behind "Show all". */
const NARROWED_SHOWN = 12;

/** The matches a narrowed section draws: its most connected first, all of them once opened. */
function narrowedShown(env: NotesEnv, ids: readonly string[], key: string, disclosure: Disclosure): Set<string> {
  return new Set(disclosure.open.has(key) ? ids : rankNotes(env.index, ids).slice(0, NARROWED_SHOWN));
}

function ShowAll({ total, id, disclosure }: { total: number; id: string; disclosure: Disclosure }) {
  if (total <= NARROWED_SHOWN) return null;
  const open = disclosure.open.has(id);
  return (
    <p className="vn-skipped">
      <button type="button" className="vn-link" onClick={() => disclosure.toggle(id)}>
        {open ? "Show fewer" : `Show all ${plural(total, "note")}`}
      </button>
    </p>
  );
}

/**
 * A source, whole: what it is and what it fed in the margin; its key ideas,
 * then every note part by part. Narrowed (a search, a filter, a scope that
 * holds only some of it): the notes that match, under their parts.
 */
export function SourceSection({ source, ids, whole, env, disclosure, reviewing, onReview }: {
  source: NotesSource;
  ids: readonly string[];
  whole: boolean;
  env: NotesEnv;
  disclosure: Disclosure;
  reviewing: boolean;
  onReview: () => void;
}) {
  const { index } = env;
  const none = source.id === UNSOURCED;
  const waiting = source.noteIds.filter((id) => {
    const n = index.byId.get(id);
    return n ? needsReview(n) : false;
  }).length;
  const fed = topicsFed(index, source.noteIds);
  const cross = none ? [] : crossSourceLinks(index, source);
  // The page's first section: its first list's first row is the tour's "Open a note".
  let tour = env.tourSection === source.id;
  const takeTour = () => {
    const t = tour;
    tour = false;
    return t;
  };
  const added = addedLine(source);
  const margin = (
    <>
      <p className="vn-kick">
        <VaultIcon name={none ? "notes" : sourceIcon(source)} size={15} />
        {none ? "No recorded source" : (source.label ?? "Source")}
      </p>
      <h2>{highlight(source.name, env.words)}</h2>
      <p className="vn-facts">
        <b>{plural(source.noteIds.length, "note")}</b>
        {!none && source.partCount > 1 && <> from {plural(source.partCount, source.partWord)}</>}
        {none && <> written in the vault, or whose source was removed</>}
        {added && (
          <>
            <br />
            {added}
          </>
        )}
      </p>
      {waiting > 0 && !reviewing && (
        <div className="vn-wait">
          <b>{plural(waiting, "note")} to review.</b> {waiting === 1 ? "It's" : "They're"} already searchable and used in answers.
          <button type="button" onClick={onReview}>
            Review them
          </button>
        </div>
      )}
      {fed.length > 0 && (
        <>
          <h3>Topics it fed</h3>
          <Bars of="topics" items={fed.map((f) => ({ key: f.moc.id, label: f.moc.title, count: f.count }))} />
        </>
      )}
      {cross.length > 0 && (
        <>
          <h3>Connects to</h3>
          <ul className="vn-cx">
            {cross.slice(0, 3).map((c) => (
              <li key={c.source.id}>
                {c.source.name} <small>{plural(c.count, "link")}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      {!none && (env.openSource || (source.additionId && env.showSourceInGraph)) && (
        <div className="vn-acts">
          {env.openSource && (
            <button type="button" className="vault-btn" onClick={() => env.openSource?.(source)}>
              <VaultIcon name="sources" size={15} />
              Open source
            </button>
          )}
          {source.additionId && env.showSourceInGraph && (
            <button type="button" className="vault-btn" onClick={() => source.additionId && env.showSourceInGraph?.(source.additionId)}>
              <VaultIcon name="graph" size={15} />
              Show in graph
            </button>
          )}
        </div>
      )}
    </>
  );

  let body: ReactNode;
  if (!whole) {
    const shown = narrowedShown(env, ids, `all:${source.id}`, disclosure);
    body = source.parts.map((p) => {
      const matched = p.noteIds.filter((id) => shown.has(id));
      if (!matched.length) return null;
      return (
        <div key={p.id}>
          {p.title && (
            <div className="vn-subhd">
              {p.title} <small>{plural(matched.length, "note")}</small>
            </div>
          )}
          <NoteRows ids={rankNotes(index, matched)} env={env} context="source" tour={takeTour()} />
        </div>
      );
    });
    body = [body, <ShowAll key="all" total={ids.length} id={`all:${source.id}`} disclosure={disclosure} />];
  } else if (source.noteIds.length <= 4) {
    body = (
      <>
        <h3 className="vn-lbl">Its notes</h3>
        <NoteRows ids={keyIdeas(index, source.noteIds, 4)} env={env} context="source" keyIdeas tour={takeTour()} />
      </>
    );
  } else {
    const key = keyIdeas(index, source.noteIds);
    const folds = source.parts.length > 1 ? source.parts : [];
    const allOpen = folds.length > 0 && folds.every((p) => disclosure.open.has(p.id));
    const rest = source.noteIds.filter((id) => !key.includes(id));
    body = (
      <>
        <h3 className="vn-lbl">Key ideas {KEY_HINT}</h3>
        <NoteRows ids={key} env={env} context="source" keyIdeas tour={takeTour()} />
        <div className="vn-outline">
          {folds.length > 0 ? (
            <>
              <div className="vn-olhead">
                <h3 className="vn-lbl">
                  All {plural(source.noteIds.length, "note")}, {source.partWord} by {source.partWord}
                </h3>
                <button type="button" className="vn-link" onClick={() => disclosure.setMany(folds.map((p) => p.id), !allOpen)}>
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
              </div>
              <ul className="vn-ol">
                {folds.map((p) => (
                  <Fold key={p.id} id={p.id} title={p.title} count={p.noteIds.length} disclosure={disclosure}>
                    <NoteRows ids={p.noteIds} env={env} context="source" />
                  </Fold>
                ))}
              </ul>
              {source.emptyParts.length > 0 && (
                <p className="vn-skipped">
                  {plural(source.emptyParts.length, source.partWord)} gave no notes: {source.emptyParts.map((p) => p.title).join(", ")}.
                </p>
              )}
            </>
          ) : (
            <ul className="vn-ol">
              <Fold id={`rest:${source.id}`} title={`The other ${plural(rest.length, "note")}`} disclosure={disclosure}>
                <NoteRows ids={rest} env={env} context="source" />
              </Fold>
            </ul>
          )}
        </div>
      </>
    );
  }
  return <Section label={source.name} margin={margin}>{body}</Section>;
}

/**
 * A topic area (its topics folded under its key ideas) or a topic on its own,
 * with the sources its notes came from in the margin.
 */
export function TopicSection({ group, ids, whole, env, disclosure }: { group: NotesTopicGroup; ids: readonly string[]; whole: boolean; env: NotesEnv; disclosure: Disclosure }) {
  const { index } = env;
  const moc = group.moc;
  const title = moc?.title ?? "Notes in no topic yet";
  const area = group.subtopics.length > 0;
  const from = sourcesOf(index, group.noteIds).filter((s) => s.source.id !== UNSOURCED);
  let tour = env.tourSection === (moc?.id ?? "loose");
  const takeTour = () => {
    const t = tour;
    tour = false;
    return t;
  };
  const margin = (
    <>
      <p className="vn-kick">
        <span className="vn-dia" aria-hidden="true" />
        {!moc ? "Not in a topic" : area ? `A topic area of ${plural(group.subtopics.length + group.emptySubtopics.length, "topic")}` : "A topic"}
      </p>
      <h2>{highlight(title, env.words)}</h2>
      <p className="vn-facts">
        <b>{plural(group.noteIds.length, "note")}</b>
      </p>
      {moc?.description && <p className="vn-md">{moc.description}</p>}
      {!moc && <p className="vn-md">Notes are placed in topics while their source is processed. These are not in one yet.</p>}
      {from.length > 0 && (
        <>
          <h3>Where its notes came from</h3>
          <Bars of="sources" items={from.map((s) => ({ key: s.source.id, label: s.source.name, count: s.count, icon: sourceIcon(s.source) }))} />
        </>
      )}
      {moc && (env.openTopic || env.showNoteInGraph) && (
        <div className="vn-acts">
          {env.openTopic && (
            <button type="button" className="vault-btn" onClick={() => env.openTopic?.(moc.id)}>
              <VaultIcon name="topics" size={15} />
              Open topic
            </button>
          )}
          {env.showNoteInGraph && (
            <button type="button" className="vault-btn" onClick={() => env.showNoteInGraph?.(moc.id)}>
              <VaultIcon name="graph" size={15} />
              Show in graph
            </button>
          )}
        </div>
      )}
    </>
  );

  let body: ReactNode;
  if (!whole) {
    const allKey = `all:${moc?.id ?? "loose"}`;
    const shown = narrowedShown(env, ids, allKey, disclosure);
    const parts = area ? group.subtopics : [{ moc, noteIds: group.noteIds }];
    body = parts.map((t, i) => {
      const matched = t.noteIds.filter((id) => shown.has(id));
      if (!matched.length) return null;
      return (
        <div key={t.moc?.id ?? i}>
          {area && t.moc && (
            <div className="vn-subhd">
              <span className="vn-dia" aria-hidden="true" />
              {highlight(t.moc.title, env.words)} <small>{plural(matched.length, "note")}</small>
            </div>
          )}
          <NoteRows ids={rankNotes(index, matched)} env={env} context="topic" tour={takeTour()} />
        </div>
      );
    });
    // Notes held by the area itself, not by one of its topics.
    if (area) {
      const inTopics = new Set(group.subtopics.flatMap((t) => t.noteIds));
      const own = group.noteIds.filter((id) => shown.has(id) && !inTopics.has(id));
      if (own.length) body = [body, <NoteRows key="own" ids={rankNotes(index, own)} env={env} context="area" tour={takeTour()} />];
    }
    body = [body, <ShowAll key="all" total={ids.length} id={allKey} disclosure={disclosure} />];
  } else if (area) {
    body = (
      <>
        <h3 className="vn-lbl">Key ideas {KEY_HINT}</h3>
        <NoteRows ids={keyIdeas(index, group.noteIds)} env={env} context="area" keyIdeas tour={takeTour()} />
        <div className="vn-outline">
          <div className="vn-olhead">
            <h3 className="vn-lbl">All {plural(group.noteIds.length, "note")}, topic by topic</h3>
          </div>
          <ul className="vn-ol">
            {group.subtopics.map((t) => (
              <Fold key={t.moc.id} id={`t:${t.moc.id}`} title={t.moc.title} count={t.noteIds.length} dia disclosure={disclosure}>
                {t.moc.description && <p className="vn-td">{t.moc.description}</p>}
                <NoteRows ids={t.noteIds} env={env} context="topic" />
              </Fold>
            ))}
          </ul>
          {group.emptySubtopics.length > 0 && (
            <p className="vn-skipped">
              {group.emptySubtopics.map((m) => m.title).join(", ")} {group.emptySubtopics.length === 1 ? "has" : "have"} no notes yet.
            </p>
          )}
        </div>
      </>
    );
  } else {
    const key = keyIdeas(index, group.noteIds, group.noteIds.length <= 4 ? 4 : 3);
    const rest = group.noteIds.filter((id) => !key.includes(id));
    body = (
      <>
        <h3 className="vn-lbl">{rest.length ? <>Key ideas {KEY_HINT}</> : "Its notes"}</h3>
        <NoteRows ids={key} env={env} context="topic" keyIdeas tour={takeTour()} />
        {rest.length > 0 && (
          <div className="vn-outline">
            <ul className="vn-ol">
              <Fold id={`rest:${moc?.id ?? "loose"}`} title={`The other ${plural(rest.length, "note")}`} disclosure={disclosure}>
                <NoteRows ids={rest} env={env} context="topic" />
              </Fold>
            </ul>
          </div>
        )}
      </>
    );
  }
  return <Section label={title} margin={margin}>{body}</Section>;
}

/** The end of what is drawn: more as you scroll, or the end of the list. */
export function MoreRow({ endRef, more, loading, end, onTop }: { endRef: RefObject<HTMLDivElement | null>; more: boolean; loading: string; end: string | null; onTop?: () => void }) {
  if (more) {
    return (
      <div ref={endRef} className="vn-more-row" role="status" aria-live="polite">
        <span className="vn-spin" aria-hidden="true" />
        {loading}
      </div>
    );
  }
  if (!end) return null;
  return (
    <div className="vn-more-row" data-end="" role="status">
      <span>{end}</span>
      {onTop && (
        <button type="button" className="vn-link" onClick={onTop}>
          Back to top
        </button>
      )}
    </div>
  );
}
