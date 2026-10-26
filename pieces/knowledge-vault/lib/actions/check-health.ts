import { createAction, Property } from "@powerhousedao/pieces-framework";
import { knowledgeVaultAuth } from "../auth.js";
import { KnowledgeVaultApiError } from "../common/errors.js";
import { clientForContext } from "../common/context.js";
import { driveProp } from "../common/props.js";

type Status = "PASS" | "WARN" | "FAIL";
/** What `POST health` wrote to the vault's health report. */
export type HealthAnswer = {
  reportId: string;
  generatedAt: string;
  overallStatus: Status;
  metrics: { noteCount: number; mocCount: number; connectionCount: number; orphanCount: number; danglingLinkCount: number; mocCoverage: number; averageLinksPerNote: number; density: number };
  checks: { category: string; status: Status; message: string }[];
  recommendations: string[];
  readBack: "confirmed" | "unconfirmed" | "skipped";
};

/** What `POST health` answers when it wrote nothing: other sources still queued, or the same grade as on file. */
export type HealthSkipped = { reportId: string; skipped: "busy"; openTasks: number } | { reportId: string; skipped: "unchanged"; overallStatus: Status };

/** When the step writes the report: once the batch is through (the workflows), or every time it runs. */
export const whenProp = Property.StaticDropdown({
  displayName: "When",
  description: "After the last queued source: one report per batch, written once no other source is waiting or being processed, and only when the vault's health changed. Every time: on each run.",
  required: true,
  defaultValue: "idle",
  options: { disabled: false, options: [{ label: "After the last queued source", value: "idle" }, { label: "Every time", value: "always" }] },
});

/** One line a person reads in Workflow Studio: the grade, the size, and what is not passing. */
export function healthSummary(answer: HealthAnswer): string {
  const m = answer.metrics;
  const open = answer.checks.filter((c) => c.status !== "PASS");
  const size = `${m.noteCount} note${m.noteCount === 1 ? "" : "s"}, ${m.mocCount} map${m.mocCount === 1 ? "" : "s"}, ${m.averageLinksPerNote.toFixed(1)} links per note`;
  return `Health report rewritten: ${answer.overallStatus} (${size}). ${open.length ? open.map((c) => `${c.status} ${c.category}: ${c.message}`).join("; ") : "Every check passes."}`;
}

/**
 * The pipeline's last step: the vault's health, measured and written down. The Switchboard grades the vault with
 * the checks its Health view uses and rewrites the health report (`POST health`), so the report follows each
 * source's notes instead of waiting for someone to run /health. No model: it reads the graph and writes the report.
 */
export const checkHealthAction = createAction({
  auth: knowledgeVaultAuth,
  name: "check-health",
  displayName: "Check vault health",
  description:
    "Measures the vault and rewrites its health report, the one the vault's Health view shows: orphan notes, links per note, descriptions, note types and provenance, topics, open tensions and pending observations, with what to do about each. Nothing else in the vault changes, and no model is used.",
  audience: "both",
  props: { drive: driveProp, when: whenProp },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "overall_status", label: "Overall" },
      { key: "checks", label: "Checks" },
      { key: "recommendations", label: "To do" },
    ],
  },
  async run(context) {
    const client = clientForContext(context);
    const drive = String(context.propsValue.drive);
    const idle = context.propsValue.when !== "always";
    let answer: HealthAnswer | HealthSkipped;
    try {
      answer = await client.request<HealthAnswer | HealthSkipped>({ method: "POST", path: "health", query: { drive, by: "vault-pipeline", ...(idle ? { when: "idle" } : {}) }, json: {} });
    } catch (error) {
      // A vault without a report (made by hand, without its standing documents) is not a failed pipeline.
      if (error instanceof KnowledgeVaultApiError && error.status === 404) {
        return { summary: "This vault has no health report to write; the vault app adds one when it opens the vault.", overall_status: null, checks: [], recommendations: [] };
      }
      throw error;
    }
    if ("skipped" in answer) {
      return answer.skipped === "busy"
        ? { summary: `Health report left for the last source in this batch: ${answer.openTasks} other source${answer.openTasks === 1 ? " is" : "s are"} still queued or being processed.`, overall_status: null, skipped: "busy", checks: [], recommendations: [] }
        : { summary: `Health report unchanged: the vault's health is what the report already says (${answer.overallStatus}).`, overall_status: answer.overallStatus, skipped: "unchanged", checks: [], recommendations: [] };
    }
    return {
      summary: healthSummary(answer),
      overall_status: answer.overallStatus,
      report_id: answer.reportId,
      generated_at: answer.generatedAt,
      metrics: answer.metrics,
      checks: answer.checks,
      recommendations: answer.recommendations,
    };
  },
});
