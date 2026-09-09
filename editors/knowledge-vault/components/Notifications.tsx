/**
 * Renders whatever `notify()` publishes. Mounted once, at the app root.
 *
 * Errors persist until dismissed; everything else auto-dismisses. A failed
 * write is the case this exists for, and a permissions refusal that vanishes
 * after three seconds is barely better than one nobody showed at all.
 */
import { useEffect, useState } from "react";
import {
  subscribeNotifications,
  type Notice,
  type NoticeLevel,
} from "../../shared/notify.js";

const TONE: Record<NoticeLevel, { fg: string; bg: string }> = {
  error: { fg: "var(--bai-danger)", bg: "var(--bai-danger-soft)" },
  warning: { fg: "var(--bai-warn)", bg: "var(--bai-warn-soft)" },
  success: { fg: "var(--bai-ok)", bg: "var(--bai-ok-soft)" },
  info: { fg: "var(--bai-accent)", bg: "var(--bai-accent-soft)" },
};

const AUTO_DISMISS_MS = 6000;

export function Notifications() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(
    () =>
      subscribeNotifications((notice) => {
        setNotices((prev) => [...prev.slice(-4), notice]);
        if (notice.level !== "error") {
          setTimeout(
            () => setNotices((prev) => prev.filter((n) => n.id !== notice.id)),
            AUTO_DISMISS_MS,
          );
        }
      }),
    [],
  );

  if (notices.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {notices.map((n) => {
        const tone = TONE[n.level];
        return (
          <div
            key={n.id}
            className="pointer-events-auto rounded-xl border p-3 shadow-lg"
            style={{
              borderColor: tone.fg,
              backgroundColor: "var(--bai-surface)",
              boxShadow: `inset 3px 0 0 0 ${tone.fg}, 0 8px 24px rgba(0,0,0,0.35)`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <p
                className="text-sm font-medium"
                style={{ color: tone.fg }}
              >
                {n.message}
              </p>
              <button
                type="button"
                onClick={() =>
                  setNotices((prev) => prev.filter((x) => x.id !== n.id))
                }
                className="text-xs leading-none opacity-60"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            {n.detail ? (
              <p
                className="mt-1 text-xs leading-relaxed"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                {n.detail}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
