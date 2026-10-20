import { useEffect, useState } from "react";

/** How long "Thinking…" stays alone before the chat says what a long wait usually means. */
export const LONG_WAIT_MS = 20_000;

/**
 * "Thinking…" while the model has not answered at all — and, when that goes on,
 * what it usually means. A model on this computer may be loading (a server that
 * unloads it when idle reloads it on the next question, which can take a long
 * time when memory is short), or busy with a step of the processing pipeline,
 * which uses the same model; a hosted model may simply be slow. Without this
 * the chat looked frozen while it was only waiting.
 */
export function WaitingNote({ since }: { since?: number } = {}) {
  const [start] = useState(() => since ?? Date.now());
  const [long, setLong] = useState(() => Date.now() - start >= LONG_WAIT_MS);
  useEffect(() => {
    if (long) return;
    const timer = setTimeout(() => setLong(true), Math.max(0, LONG_WAIT_MS - (Date.now() - start)));
    return () => clearTimeout(timer);
  }, [long, start]);
  return (
    <div className="text-sm" style={{ color: "var(--bai-text-muted)" }} role="status">
      <p>Thinking…</p>
      {long && (
        <p className="mt-1 text-[12.5px] leading-snug">
          Still waiting for the AI model. A model on this computer may be loading, or busy with a processing step — it
          is shared with the pipeline; a hosted one may be slow. You can stop and ask again.
        </p>
      )}
    </div>
  );
}
