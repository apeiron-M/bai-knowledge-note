/**
 * The queue's shape at a glance: the claim pipeline's phases left to right,
 * each with how many open tasks sit there. The last phase is where a person
 * comes in (review), so it carries the accent. Clicking a phase filters the
 * table to it; clicking it again clears the filter.
 */
export function PhaseFlow(props: {
  phases: string[];
  counts: Record<string, number>;
  active: string | null;
  onSelect: (phase: string | null) => void;
}) {
  const last = props.phases.length - 1;
  return (
    <ol className="pq-flow" aria-label="Open tasks by phase">
      {props.phases.map((phase, i) => {
        const n = props.counts[phase] ?? 0;
        const selected = props.active === phase;
        const human = i === last;
        return (
          <li key={phase} className="pq-flow-step">
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => props.onSelect(selected ? null : phase)}
              className={`pq-flow-button${selected ? " is-selected" : ""}${human ? " is-human" : ""}${n === 0 ? " is-empty" : ""}`}
              title={selected ? "Show every phase" : `Show open tasks at ${phase}`}
            >
              <span className="pq-flow-count">{n}</span>
              <span className="pq-flow-name">{phase}</span>
              <span className="pq-flow-hint">{human ? "waits for you" : i === 0 ? "queued sources" : " "}</span>
            </button>
            {i < last && <span className="pq-flow-arrow" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
