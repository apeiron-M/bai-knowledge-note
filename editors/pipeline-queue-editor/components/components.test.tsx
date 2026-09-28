import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PipelineTask } from "document-models/pipeline-queue";
import { PhaseFlow } from "./phase-flow.js";
import { TaskTable } from "./task-table.js";

const PHASES = ["create", "reflect", "reweave", "verify"];
const task = (i: number, extra: Partial<PipelineTask> = {}): PipelineTask => ({
  id: `t${i}`, taskType: "claim", status: "PENDING", target: `Source ${i}`, batchId: null, documentRef: `s${i}`, currentPhase: "create",
  completedPhases: [], handoffs: [], assignedTo: null, createdAt: "2026-09-28T10:00:00Z", updatedAt: null, ...extra,
});

describe("the phase strip", () => {
  it("shows open tasks per phase, marks the one that waits for a person, and the selected one", () => {
    const html = renderToStaticMarkup(<PhaseFlow phases={PHASES} counts={{ create: 12, reflect: 0, reweave: 2, verify: 3 }} active="reweave" onSelect={() => undefined} />);
    expect(html).toMatch(/<span class="pq-flow-count">12<\/span><span class="pq-flow-name">create<\/span><span class="pq-flow-hint">queued sources<\/span>/);
    expect(html).toMatch(/is-human[^>]*>(?:(?!<\/button>).)*waits for you/);
    expect(html).toMatch(/aria-pressed="true" class="pq-flow-button is-selected"/);
    expect(html).toMatch(/is-empty/);
    expect(html.match(/pq-flow-arrow/g)).toHaveLength(3);
  });
});

describe("the task table", () => {
  it("renders a page of rows with their status, progress and source link", () => {
    const tasks = [
      task(1, { status: "PENDING", currentPhase: "verify", completedPhases: ["create", "reflect", "reweave"], assignedTo: null }),
      task(2, { status: "IN_PROGRESS", currentPhase: "reflect", assignedTo: "0xadba", updatedAt: "2026-09-28T11:59:00Z", taskType: "enrichment" }),
      task(3, { documentRef: null }),
    ];
    const html = renderToStaticMarkup(<TaskTable tasks={tasks} phases={PHASES} now={Date.parse("2026-09-28T12:00:00Z")} emptyText="empty" />);
    expect(html).toMatch(/<thead>.*Source.*Progress.*Status.*Assigned to.*Updated/);
    expect(html).toMatch(/pq-status is-review">Waiting for review/);
    expect(html).toMatch(/pq-status is-working">Working/);
    expect(html).toMatch(/title="Open &quot;Source 1&quot;"/);
    expect(html).toMatch(/pq-plain">Source 3/);
    expect(html).toMatch(/pq-type">enrichment/);
    expect(html).toMatch(/1 min ago/);
    expect(html).toMatch(/aria-label="create: done, reflect: done, reweave: done, verify: current"/);
    expect(html).toMatch(/Showing 3 of 3/);
    expect(html).not.toMatch(/Show \d+ more/);
  });
  it("pages a long queue 200 rows at a time", () => {
    const tasks = Array.from({ length: 450 }, (_, i) => task(i));
    const html = renderToStaticMarkup(<TaskTable tasks={tasks} phases={PHASES} now={0} emptyText="empty" />);
    expect(html.match(/class="pq-row /g)).toHaveLength(200);
    expect(html).toMatch(/Showing 200 of 450/);
    expect(html).toMatch(/Show 200 more/);
  });
  it("says what to do when there is nothing to show", () => {
    expect(renderToStaticMarkup(<TaskTable tasks={[]} phases={PHASES} now={0} emptyText="No source is waiting for review." />)).toBe('<p class="pq-empty">No source is waiting for review.</p>');
  });
});
