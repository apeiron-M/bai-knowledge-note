import { isNoteGroup, type SourceTimeline, type TimelineAddition } from "../../../../processors/graph-indexer/source-timeline.js";
import { countOf, factsLine } from "../../lib/timeline/additions.js";
import type { TimeWords } from "../../lib/timeline/axis.js";
import { VaultIcon } from "../vault-icons.js";

export interface AdditionDetailProps {
  addition: TimelineAddition;
  timeline: SourceTimeline;
  now: number;
  words?: TimeWords;
  /** The signed-in address, so "by you" can say so. */
  me: string | null;
  /** Name who added it — only worth saying when the vault has more than one contributor. */
  showWho?: boolean;
  onShowInGraph: (additionId: string) => void;
  onOpenSources: (folderId: string) => void;
  onOpenDocument: (documentId: string) => void;
  /** The Notes list narrowed to these notes, under this addition's name. */
  onSeeNotes?: (title: string, noteIds: string[]) => void;
}

const SHOWN_TOPICS = 6;

/** The open row: what the addition became, and how it connected to what came before. */
export function AdditionDetail(props: AdditionDetailProps) {
  const a = props.addition;
  const titles = new Map(props.timeline.topics.map((t) => [t.documentId, t.title]));
  const additions = new Map(props.timeline.additions.map((x) => [x.id, x.title]));
  const topics = a.topicIds.map((id) => ({ id, title: titles.get(id) ?? id }));
  const rest = topics.length - SHOWN_TOPICS;
  // One source opens itself, wherever it is; several open their folder, and each can be opened from the list.
  const lone = a.sources === 1 ? a.sourceIds[0] : undefined;
  const folder = isNoteGroup(a) || lone ? null : a.folderId;
  const more = a.sources - a.firstSources.length;
  return (
    <div className="tl-detail">
      <p className="tl-facts">{factsLine(a, props.now, { ...props.words, me: props.me, who: props.showWho ?? true })}</p>
      <div className="tl-cols">
        <section>
          <h4>Topics it started</h4>
          {topics.length > 0 ? (
            <ul className="tl-topics">
              {topics.slice(0, SHOWN_TOPICS).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => props.onOpenDocument(t.id)}>
                    <svg viewBox="0 0 10 10" aria-hidden="true">
                      <rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" />
                    </svg>
                    {t.title}
                  </button>
                </li>
              ))}
              {rest > 0 && <li className="tl-none">and {countOf(rest, "more topic")}</li>}
            </ul>
          ) : (
            <p className="tl-none">None yet. Its notes joined topics that already existed.</p>
          )}
          {a.tags.length > 0 && (
            <div className="tl-tags">
              {a.tags.map((t) => (
                <span key={t.name} className="tl-tag">
                  #{t.name} <i>{t.count.toLocaleString("en-US")}</i>
                </span>
              ))}
            </div>
          )}
        </section>
        <section>
          <h4>How it connected</h4>
          {a.earlier.length > 0 ? (
            <ul className="tl-from">
              {a.earlier.map((e) => (
                <li key={e.additionId}>
                  <b>{e.links.toLocaleString("en-US")}</b> to {additions.get(e.additionId) ?? "an earlier addition"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="tl-none">No links to earlier notes yet.</p>
          )}
          <p className="tl-none">{countOf(a.linksWithin, "link")} among its own notes.</p>
        </section>
      </div>
      {a.sources > 1 && a.firstSources.length > 0 && (
        <>
          <h4>Its sources</h4>
          <ul className="tl-sample tl-sources">
            {a.firstSources.map((s) => (
              <li key={s.documentId}>
                <button type="button" onClick={() => props.onOpenDocument(s.documentId)}>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
          {more > 0 && a.folderId && (
            <button type="button" className="tl-more-sources" onClick={() => props.onOpenSources(a.folderId as string)}>
              and {countOf(more, "more source", "more sources")} in its folder
            </button>
          )}
        </>
      )}
      {a.topNotes.length > 0 && (
        <>
          <h4>Its most linked notes</h4>
          <ul className="tl-sample">
            {a.topNotes.map((n) => (
              <li key={n.documentId}>
                <button type="button" onClick={() => props.onOpenDocument(n.documentId)}>
                  {n.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="tl-acts">
        <button type="button" className="vault-btn" onClick={() => props.onShowInGraph(a.id)}>
          <VaultIcon name="graph" />
          Show in graph
        </button>
        {folder && (
          <button type="button" className="vault-btn" onClick={() => props.onOpenSources(folder)}>
            <VaultIcon name="folder" />
            Open its sources
          </button>
        )}
        {lone && (
          <button type="button" className="vault-btn" onClick={() => props.onOpenDocument(lone)}>
            <VaultIcon name="sources" />
            Open the source
          </button>
        )}
        {props.onSeeNotes && a.notes > 0 && (
          <button
            type="button"
            className="vault-btn"
            onClick={() =>
              props.onSeeNotes?.(
                a.title,
                props.timeline.notes.filter((n) => n.additionId === a.id).map((n) => n.documentId),
              )
            }
          >
            <VaultIcon name="notes" />
            {a.notes === 1 ? "See its note" : `See its ${countOf(a.notes, "note")}`}
          </button>
        )}
      </div>
    </div>
  );
}
