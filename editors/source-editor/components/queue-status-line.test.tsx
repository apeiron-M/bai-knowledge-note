import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QueueTask } from "../lib/queue-status.js";
import { QueueStatusLine } from "./queue-status-line.js";

const task: QueueTask = { taskType: "claim", status: "IN_PROGRESS", currentPhase: "verify", documentRef: "s1", createdAt: "2026-10-16T10:00:00Z", handoffs: [] };

describe("the queue status line", () => {
  it("renders the line in the queued style", () => {
    expect(renderToStaticMarkup(<QueueStatusLine task={task} desktop now={0} />)).toBe('<span class="queued">Processing — checking notes</span>');
  });
  it("renders nothing without an open task", () => {
    expect(renderToStaticMarkup(<QueueStatusLine task={undefined} desktop={false} now={0} />)).toBe("");
  });
});
