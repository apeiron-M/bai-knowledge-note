import { setSelectedNode } from "@powerhousedao/reactor-browser";
import { LINK_LABEL, type Neighbour, type Neighbourhood } from "../lib/neighbourhood.js";

const TYPE_TONE: Record<string, { background: string; color: string }> = {
  BUILDS_ON: { background: "var(--bai-info-soft)", color: "var(--bai-info)" },
  DERIVED_FROM: { background: "var(--bai-warn-soft)", color: "var(--bai-warn)" },
  CONTRADICTS: { background: "var(--bai-danger-soft)", color: "var(--bai-danger)" },
  SUPERSEDES: { background: "var(--bai-accent-soft)", color: "var(--bai-accent)" },
  CORE_IDEA: { background: "var(--bai-accent-soft)", color: "var(--bai-accent)" },
  INVOLVES: { background: "var(--bai-danger-soft)", color: "var(--bai-danger)" },
};
const tone = (t: string) =>
  TYPE_TONE[t] ?? { background: "var(--bai-hover)", color: "var(--bai-text-tertiary)" };

const CONFIDENCE_TONE: Record<string, string> = {
  grounded: "var(--bai-ok)",
  established: "var(--bai-info)",
  speculative: "var(--bai-warn)",
};

/** The kind badge a non-note neighbour carries — `source`, `moc`, `tension`. */
function kindOf(n: Neighbour): string | null {
  if (n.tier) return n.tier.toLowerCase();
  if (!n.documentType || n.documentType === "bai/knowledge-note") return null;
  return n.documentType.replace(/^bai\//, "").replace(/-/g, " ");
}

/**
 * One edge, read-only: the type, where it goes, and why it exists.
 *
 * Incoming edges are shown but never editable here — they belong to the notes
 * that made them, and a remove control on this page would edit a document the
 * reader is not looking at. Opening one goes to the note that can change it.
 */
export function EdgeRow({ edge }: { edge: Neighbour }) {
  const kind = kindOf(edge);
  return (
    <div className="ne-edge">
      <div className="top">
        <span className="etype" style={tone(edge.linkType)}>
          {LINK_LABEL[edge.linkType] ?? edge.linkType}
        </span>
        <button
          type="button"
          className="t"
          onClick={() => setSelectedNode(edge.documentId)}
          title={`Open: ${edge.title}`}
        >
          {edge.title}
        </button>
        {kind && <span className="kind">{kind}</span>}
      </div>
      {edge.reason && (
        <div className="why">
          <span className="b">because</span>
          <span className="r">{edge.reason}</span>
          {edge.confidence && CONFIDENCE_TONE[edge.confidence] && (
            <span
              className="conf"
              style={{ color: CONFIDENCE_TONE[edge.confidence] }}
            >
              {edge.confidence}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The half of the graph the editor never showed: what points at this note, and
 * which maps of content hold it.
 */
export function IncomingLinks({ graph }: { graph: Neighbourhood }) {
  return (
    <>
      <p className="ne-plbl mt">
        What others say about this — {graph.incoming.length}{" "}
        {graph.incoming.length === 1 ? "note" : "notes"}
      </p>
      {graph.incoming.length === 0 ? (
        <p className="ne-narr">
          Nothing points at this note yet. A claim nothing builds on is either
          very new or a leaf.
        </p>
      ) : (
        graph.incoming.map((e) => <EdgeRow key={`${e.documentId}-${e.linkType}`} edge={e} />)
      )}
      <p className="ne-narr">
        These edges belong to the notes that made them, so they are read-only
        here — opening one goes to the note that can change it.
      </p>

      <p className="ne-plbl mt">
        Held as a core idea by — {graph.mocs.length}{" "}
        {graph.mocs.length === 1 ? "map of content" : "maps of content"}
      </p>
      {graph.mocs.length === 0 ? (
        <p className="ne-narr">
          This note is in no map of content, so it cannot be reached from the
          vault&apos;s entry point.
        </p>
      ) : (
        graph.mocs.map((e) => <EdgeRow key={e.documentId} edge={e} />)
      )}

      {graph.tensions.length > 0 && (
        <>
          <p className="ne-plbl mt">Open tensions — {graph.tensions.length}</p>
          {graph.tensions.map((e) => <EdgeRow key={e.documentId} edge={e} />)}
        </>
      )}
    </>
  );
}

/**
 * A compact answer to "where does this sit", under the note's body — so the
 * question is answered while reading rather than behind a tab.
 */
export function WhereThisSits({
  graph,
  onOpenLinks,
}: {
  graph: Neighbourhood;
  onOpenLinks: () => void;
}) {
  const derived = graph.outgoing.filter((e) => e.linkType === "DERIVED_FROM");
  const total = graph.outgoing.length + graph.incoming.length;
  return (
    <section className="ne-sits">
      <h4>Where this sits</h4>
      <div className="grid">
        <div>
          <div className="k">Maps of content</div>
          <div className="v">
            {graph.mocs.length === 0 ? (
              <span style={{ color: "var(--bai-warn)" }}>none — unreachable from the hub</span>
            ) : (
              graph.mocs.map((m) => (
                <button
                  key={m.documentId}
                  type="button"
                  className="moclink"
                  onClick={() => setSelectedNode(m.documentId)}
                >
                  {m.title}
                  {m.tier && <b>{m.tier.toLowerCase()}</b>}
                </button>
              ))
            )}
          </div>
        </div>
        <div>
          <div className="k">Connections</div>
          <div className="v tallies">
            <span className="tally"><b>{graph.outgoing.length}</b><span>out</span></span>
            <span className="tally"><b>{graph.incoming.length}</b><span>in</span></span>
            {graph.tensions.length > 0 && (
              <span className="tally">
                <b style={{ color: "var(--bai-danger)" }}>{graph.tensions.length}</b>
                <span>open tensions</span>
              </span>
            )}
          </div>
        </div>
        {derived.length > 0 && (
          <div>
            <div className="k">Derived from</div>
            <div className="v">
              {derived.map((d) => d.reason ?? d.title).join(" · ")}
            </div>
          </div>
        )}
      </div>
      {total > 0 && (
        <p className="more">
          Every edge carries why it exists.{" "}
          <button type="button" onClick={onOpenLinks}>
            See all {total} with their reasons →
          </button>
        </p>
      )}
    </section>
  );
}
