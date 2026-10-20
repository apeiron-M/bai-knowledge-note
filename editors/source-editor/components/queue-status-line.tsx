import { queueStatusLine, type QueueTask } from "../lib/queue-status.js";

/** The queue status under a source's actions; reuses the editor's "queued" style. */
export function QueueStatusLine(props: { task: QueueTask | undefined; desktop: boolean; now: number }) {
  const line = queueStatusLine(props.task, { desktop: props.desktop, now: props.now });
  return line ? <span className="queued">{line}</span> : null;
}
