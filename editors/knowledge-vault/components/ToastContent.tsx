/**
 * The body of a vault notice, for both toast hosts — and the owner of its
 * lifetime.
 *
 * Two lines, not one: the headline is the verdict a person scans for, the
 * detail is the fact an expert needs (which operation, the server's reason).
 * Joined with a dash they were one long grey sentence with nothing to land on.
 *
 * Colour lives in exactly one place — the glyph disc. Severity was previously
 * painted on the frame as well, which made a permissions decision look like
 * an alarm and competed with the status colours of the UI behind it. The disc
 * uses the palette's `*-soft` tint under a hairline glyph, the same device the
 * rest of the vault uses for status chips, so the toast reads as part of the
 * product rather than a library default.
 *
 * Lifetime: react-toastify clones element content with a `closeToast` prop;
 * the fallback host passes `onDismiss`. Either way the notice takes itself
 * down after `ttlMs` of wall-clock time — pausing while hovered or focused,
 * never because the window lost focus — and registers with the shared ledger
 * so no more than a few are ever up at once (toast-lifetime.ts).
 */
import { useEffect, useRef } from "react";
import type { Notice, NoticeLevel } from "../../shared/notify.js";
import { presentDetail } from "../../shared/toast-copy.js";
import { createDismissTimer, noticeLedger } from "../../shared/toast-lifetime.js";

function Glyph({ level }: { level: NoticeLevel }) {
  // 16px, stroke-only, round joins: the same weight as the vault's icons.
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (level) {
    case "error":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 4.75v3.75" />
          <path d="M8 11.1v.15" strokeWidth="2.2" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M8 2.6 14.1 13H1.9L8 2.6Z" />
          <path d="M8 6.4v3.1" />
          <path d="M8 11.5v.15" strokeWidth="2.2" />
        </svg>
      );
    case "success":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="m5.2 8.2 1.9 1.9 3.8-4.1" />
        </svg>
      );
    case "info":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.3v3.9" />
          <path d="M8 4.9v.15" strokeWidth="2.2" />
        </svg>
      );
  }
}

/** The card the notice sits in — the host's toast, or our fallback card. */
const HOST_SELECTOR = ".Toastify__toast, .bai-toast-card";

/**
 * Take the notice down after its lifetime. Reads the dismisser through a ref
 * so a host passing a fresh closure each render (the fallback does) never
 * restarts the clock.
 */
function useNoticeLifetime(
  rootRef: React.RefObject<HTMLDivElement | null>,
  notice: Notice,
  dismiss: (() => void) | undefined,
) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (!dismissRef.current) return;
    const takeDown = () => dismissRef.current?.();
    const leave = noticeLedger.enter(takeDown);
    const timer = createDismissTimer(notice.ttlMs, () => {
      leave();
      takeDown();
    });

    const host = rootRef.current?.closest<HTMLElement>(HOST_SELECTOR) ?? rootRef.current;
    const pause = () => timer.pause();
    const resume = () => timer.resume();
    host?.addEventListener("mouseenter", pause);
    host?.addEventListener("mouseleave", resume);
    host?.addEventListener("focusin", pause);
    host?.addEventListener("focusout", resume);

    return () => {
      timer.cancel();
      leave();
      host?.removeEventListener("mouseenter", pause);
      host?.removeEventListener("mouseleave", resume);
      host?.removeEventListener("focusin", pause);
      host?.removeEventListener("focusout", resume);
    };
    // The identity of the notice is its id; a new notice is a new lifetime.
  }, [rootRef, notice.id, notice.ttlMs]);
}

export function ToastContent({
  notice,
  closeToast,
  onDismiss,
}: {
  notice: Notice;
  /** Injected by react-toastify when this element is a toast's content. */
  closeToast?: () => void;
  /** Passed by the fallback host. */
  onDismiss?: () => void;
  /** Also injected by react-toastify; not used. */
  toastProps?: unknown;
  data?: unknown;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useNoticeLifetime(rootRef, notice, onDismiss ?? closeToast);
  const detail = notice.detail ? presentDetail(notice.detail) : "";
  return (
    <div ref={rootRef} className="bai-toast" data-level={notice.level}>
      <span className="bai-toast-glyph" aria-hidden>
        <Glyph level={notice.level} />
      </span>
      <div className="bai-toast-text">
        <p className="bai-toast-title">{notice.message}</p>
        {detail ? <p className="bai-toast-detail">{detail}</p> : null}
      </div>
    </div>
  );
}
