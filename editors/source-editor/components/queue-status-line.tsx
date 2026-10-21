import { queueStatusLine, type QueueAi, type QueueHost, type QueueTask } from "../lib/queue-status.js";

/** The queue status under a source's actions; reuses the editor's "queued" style. */
export function QueueStatusLine(props: { task: QueueTask | undefined; host: QueueHost; ai?: QueueAi; now: number }) {
  const line = queueStatusLine(props.task, { host: props.host, ai: props.ai, now: props.now });
  return line ? <span className="queued">{line}</span> : null;
}
