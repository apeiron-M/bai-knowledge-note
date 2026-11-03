import type { CSSProperties, ReactNode } from "react";
import { prefetchOnHover } from "../../lib/prefetch.js";
import { KIND_HELP, LINK_WORDS, STATUS_WORDS, UNSOURCED, degree, needsReview, type NotesIndex, type NotesSource } from "../../lib/notes-view.js";
import { kindLabel, plural } from "../../lib/vault-lookups.js";
import { VaultIcon } from "../vault-icons.js";

/** What the page hands every section and row. */
export type NotesEnv = {
  index: NotesIndex;
  /** The search, as words; empty for none. */
  words: readonly string[];
  /** The note opened in place, if any. */
  peek: string | null;
  togglePeek: (id: string) => void;
  openNote: (id: string) => void;
  showNoteInGraph?: (id: string) => void;
  openSource?: (source: NotesSource) => void;
  showSourceInGraph?: (additionId: string) => void;
  openTopic?: (id: string) => void;
  /** The section drawn first: the first row of its first list carries the Try on web tour's anchor. */
  tourSection?: string;
};

/** How a row is grouped: its meta line leaves out what the group already says. */
export type RowContext = "source" | "topic" | "area" | "all";

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The searched words, marked where they occur. */
export function highlight(text: string, words: readonly string[]): ReactNode {
  const useful = words.filter((w) => w.length > 1);
  if (!useful.length || !text) return text;
  const parts = text.split(new RegExp(`(${useful.map(escape).join("|")})`, "gi"));
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
}

/** A note's dot: the Graph's node, sized by how connected it is. */
function Dot({ links, big }: { links: number; big?: boolean }) {
  const d = Math.min(12, 5 + Math.sqrt(links) * 1.6) + (big ? 1 : 0);
  return <span className="vn-dot" style={{ "--d": `${d.toFixed(1)}px` } as CSSProperties} aria-hidden="true" />;
}

/** `tour`: this is the page's first list, and its first row is the one the Try on web tour points at ("Open a note"). */
export function NoteRows({ ids, env, context, keyIdeas = false, tour = false }: { ids: readonly string[]; env: NotesEnv; context: RowContext; keyIdeas?: boolean; tour?: boolean }) {
  return (
    <ol className={keyIdeas ? "vn-list vn-key" : "vn-list"}>
      {ids.map((id, i) => (
        <NoteRow key={id} id={id} env={env} context={context} big={keyIdeas} tour={tour && i === 0} />
      ))}
    </ol>
  );
}

function NoteRow({ id, env, context, big, tour }: { id: string; env: NotesEnv; context: RowContext; big: boolean; tour: boolean }) {
  const note = env.index.byId.get(id);
  if (!note) return null;
  const open = env.peek === id;
  const title = note.title ?? note.name;
  return (
    <li className="vn-row" data-tour={tour ? "note-card" : undefined}>
      <span className="vn-nd">
        <Dot links={degree(env.index, id)} big={big} />
      </span>
      <button type="button" className="vn-claim" onClick={() => env.openNote(id)} {...prefetchOnHover(id)}>
        {highlight(title, env.words)}
      </button>
      <button type="button" className="vn-pk" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={() => env.togglePeek(id)}>
        <VaultIcon name="down" />
      </button>
      <NoteMeta id={id} env={env} context={context} />
      {open && <NoteDetails id={id} env={env} />}
    </li>
  );
}

function NoteMeta({ id, env, context }: { id: string; env: NotesEnv; context: RowContext }) {
  const note = env.index.byId.get(id);
  if (!note) return null;
  const kind = kindLabel(note.noteType);
  const help = note.noteType ? KIND_HELP[note.noteType] : undefined;
  const source = env.index.sourceOf.get(id);
  const topic = env.index.topicOf.get(id);
  const links = degree(env.index, id);
  const status = note.status ? STATUS_WORDS[note.status] : undefined;
  return (
    <div className="vn-meta">
      {kind && (
        <span className="vn-kd" title={help ? `${kind}: ${help}` : undefined}>
          {kind}
        </span>
      )}
      {context !== "source" && source && source.id !== UNSOURCED && (
        <span>
          from <i>{highlight(source.name, env.words)}</i>
        </span>
      )}
      {context !== "topic" && topic && (
        <span className="vn-tp">
          <span className="vn-dia" aria-hidden="true" />
          {highlight(topic.title, env.words)}
        </span>
      )}
      {links > 0 && <span>linked to {plural(links, "note")}</span>}
      {status && <span className={needsReview(note) ? "vn-wt" : undefined}>{status}</span>}
    </div>
  );
}

/** A note opened in place: what it says, where it came from, how it links — before opening it. */
function NoteDetails({ id, env }: { id: string; env: NotesEnv }) {
  const { index } = env;
  const note = index.byId.get(id);
  if (!note) return null;
  const source = index.sourceOf.get(id);
  const part = index.partOf.get(id);
  const passage = index.passageOf.get(id);
  const groups = new Map<string, { other: string; reason: string | null }[]>();
  for (const l of [...(index.links.get(id) ?? [])].sort((a, b) => (a.dir === b.dir ? 0 : a.dir === "out" ? -1 : 1))) {
    const words = LINK_WORDS[l.type] ?? ["Links to", "Linked from"];
    const label = l.dir === "out" ? words[0] : words[1];
    const list = groups.get(label);
    if (list) list.push(l);
    else groups.set(label, [l]);
  }
  const author = note.provenance?.author;
  return (
    <div className="vn-peek">
      {note.description && <p className="vn-pd">{highlight(note.description, env.words)}</p>}
      {source && source.id !== UNSOURCED && (
        <div className="vn-prow">
          <span>Taken from</span>
          <div>
            <b>{part?.title ?? source.name}</b>
            {part && part.title !== source.name && <> in {source.name}</>}
            {passage && (
              <>
                <br />
                {passage}
              </>
            )}
          </div>
        </div>
      )}
      {groups.size === 0 ? (
        <div className="vn-prow">
          <span>Links</span>
          <div>Not linked to another note yet.</div>
        </div>
      ) : (
        [...groups].map(([label, list]) => (
          <div className="vn-prow" key={label}>
            <span>{label}</span>
            <div>
              {list.slice(0, 2).map((l) => (
                <span className="vn-lk" key={l.other}>
                  <button type="button" onClick={() => env.openNote(l.other)} {...prefetchOnHover(l.other)}>
                    {index.byId.get(l.other)?.title ?? l.other}
                  </button>
                  {l.reason && <small>{l.reason}</small>}
                </span>
              ))}
              {list.length > 2 && (
                <span className="vn-lk">
                  <small>and {plural(list.length - 2, "more note")} in the note</small>
                </span>
              )}
            </div>
          </div>
        ))
      )}
      <div className="vn-prow">
        <span>State</span>
        <div>
          {stateLine(note.status)}
          {author ? ` Written by ${author}.` : ""}
        </div>
      </div>
      <div className="vn-acts">
        <button type="button" className="btn btn-primary" onClick={() => env.openNote(id)}>
          <VaultIcon name="open" size={15} />
          Open note
        </button>
        {env.showNoteInGraph && (
          <button type="button" className="btn btn-quiet" onClick={() => env.showNoteInGraph?.(id)}>
            <VaultIcon name="graph" size={15} />
            Show in graph
          </button>
        )}
      </div>
    </div>
  );
}

function stateLine(status: string | null): string {
  switch (status) {
    case "IN_REVIEW":
      return "Waiting for your review. It's already searchable and used in answers.";
    case "DRAFT":
      return "A draft: not finished yet.";
    case "ARCHIVED":
      return "Archived: kept for its history, left out of search.";
    default:
      return "Approved.";
  }
}
