import type { CSSProperties } from "react";
import { keyIdeas, type NotesIndex, type NotesSource } from "../../lib/notes-view.js";
import { plural } from "../../lib/vault-lookups.js";
import { VaultIcon } from "../vault-icons.js";

/** "a book", "an email": a source's kind inside a sentence. Workflows and agents are said differently (shapeOf). */
const NOUN: Record<string, string> = { Book: "a book", PDF: "a PDF", Email: "an email", Documentation: "documentation", Transcript: "a transcript", "Web page": "a web page", Text: "text you added" };

/** "a book in 26 chapters", "266 items from a workflow", "an email"; empty when nothing is known. */
export function shapeOf(source: Pick<NotesSource, "label" | "partCount" | "partWord">): string {
  const parts = source.partCount > 1 ? plural(source.partCount, source.partWord) : null;
  const noun = source.label ? NOUN[source.label] : undefined;
  if (noun) return parts ? `${noun} in ${parts}` : noun;
  if (source.label === "Written by an agent") return parts ? `${parts} written by an agent` : "written by an agent";
  if (source.label && source.partWord === "item") return parts ? `${parts} from a workflow` : "from a workflow";
  return parts ? `in ${parts}` : "";
}

/** The four steps, told with the vault's own largest source when it has one. */
export type HowExample = {
  source: string;
  /** "a book in 26 chapters", "266 items from a workflow"; may be empty. */
  shape: string;
  claim: string;
  topic: string | null;
  topicNotes: number;
  links: number;
  fromElsewhere: number;
};

export function howExample(index: NotesIndex): HowExample | null {
  const source = [...index.sources].filter((s) => s.kind !== "none").sort((a, b) => b.noteIds.length - a.noteIds.length).at(0);
  const idea = source ? keyIdeas(index, source.noteIds, 1).at(0) : undefined;
  const note = idea ? index.byId.get(idea) : undefined;
  if (!source || !idea || !note) return null;
  const topic = index.topicOf.get(idea);
  const incoming = (index.links.get(idea) ?? []).filter((l) => l.dir === "in");
  return {
    source: source.name,
    shape: shapeOf(source),
    claim: note.title ?? note.name,
    topic: topic?.title ?? null,
    topicNotes: topic ? new Set(topic.coreIdeas.map((c) => c.noteRef).filter((id) => index.byId.has(id))).size : 0,
    links: incoming.length,
    fromElsewhere: incoming.filter((l) => index.sourceOf.get(l.other) !== source).length,
  };
}

/**
 * How notes work (design: the first visit's explainer, the empty vault's
 * lesson): a source becomes notes, notes gather in topics, notes link and say why.
 */
export function HowNotesWork({ example, onDismiss }: { example: HowExample | null; onDismiss?: () => void }) {
  const e = example;
  return (
    <section className="vn-how" aria-label="How notes work">
      <h2>How notes work</h2>
      {onDismiss && (
        <button type="button" className="vn-x" onClick={onDismiss} aria-label="Hide how notes work">
          <VaultIcon name="close" size={15} />
        </button>
      )}
      <ol>
        <li>
          <b>You add a source</b>
          <span className="vn-ex">
            <VaultIcon name="book" size={15} />
            <span>{e ? (e.shape ? `${e.source}, ${e.shape}` : e.source) : "A book, a report, an email or a meeting transcript"}</span>
          </span>
        </li>
        <li>
          <b>The vault writes a note for each idea in it</b>
          <span className="vn-ex">
            <span className="vn-dot" style={{ "--d": "7px" } as CSSProperties} aria-hidden="true" />
            {e ? <q>{e.claim}</q> : <span>One idea per note, written as a sentence you can agree or disagree with</span>}
          </span>
        </li>
        <li>
          <b>Notes on one theme gather in a topic</b>
          <span className="vn-ex">
            <span className="vn-dia" aria-hidden="true" />
            <span>{e?.topic ? `${e.topic} holds ${plural(e.topicNotes, "note")}` : "Topics grow as more of your sources touch them"}</span>
          </span>
        </li>
        <li>
          <b>Notes link to the notes they build on, and say why</b>
          <span className="vn-ex">
            <VaultIcon name="link" size={15} />
            <span>
              {e && e.links > 0
                ? `${plural(e.links, "note")} ${e.links === 1 ? "links" : "link"} to that one${!e.fromElsewhere ? "" : e.links === 1 ? ", from another source" : `, ${e.fromElsewhere} of them from ${e.fromElsewhere === 1 ? "another source" : "other sources"}`}`
                : "So an answer can follow an idea from one source to another"}
            </span>
          </span>
        </li>
      </ol>
      <div className="vn-how-foot">
        <span>Notes the vault writes wait for your review. In the meantime they're already searchable and used in answers.</span>
        {onDismiss && (
          <button type="button" className="vault-btn" onClick={onDismiss}>
            Got it
          </button>
        )}
      </div>
    </section>
  );
}
