/**
 * Renders whatever `notify()` publishes. Mounted once, at the app root.
 *
 * Prefers Connect's own toast so notifications look like the rest of the
 * platform. `usePHToast` returns `PHToastFn | undefined`, though, and an error
 * reporter that silently does nothing would be worse than none — so the local
 * renderer below stays as the fallback for when no toast host is mounted.
 * Both hosts render the same `ToastContent`, so a notice looks identical
 * whichever one shows it; the card itself is styled in style.css
 * (`.Toastify__toast` under `html[data-bai-toast-theme]`, and `.bai-toast-card`
 * for the fallback), where light and dark are one set of rules.
 *
 * Every notice leaves on its own, after the lifetime `notify()` gave it, and
 * no more than a few are up at once. Both are ToastContent's doing (see
 * toast-lifetime.ts): the host's own `autoClose` is switched off for our
 * toasts because Connect's container pauses every clock whenever the window
 * loses focus — which is most of the time while an agent is working — so
 * notices used to accumulate behind the user's back. These are about
 * requests, and the durable statement of a state — signed out, not granted,
 * unreachable — is the AuthGate's job, not a toast's.
 */
import { useEffect, useState } from "react";
import { usePHToast } from "@powerhousedao/reactor-browser";
import { subscribeNotifications, type Notice } from "../../shared/notify.js";
import { ToastContent } from "./ToastContent.js";

type ToastFn = NonNullable<ReturnType<typeof usePHToast>>;
type ToastOptions = NonNullable<Parameters<ToastFn>[1]>;

export function Notifications() {
  const toast = usePHToast();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(
    () =>
      subscribeNotifications((notice) => {
        if (toast) {
          // The design-system's `toast()` spreads unknown options through to
          // react-toastify. `autoClose: false` hands the lifetime to
          // ToastContent (react-toastify injects `closeToast` into element
          // content); `icon: false` drops the library's filled-circle icon —
          // ToastContent draws its own — and the class lets style.css lay out
          // our body without touching Connect's own toasts.
          const options = {
            type: notice.level,
            autoClose: false,
            icon: false,
            className: "bai-toast-host",
          } as ToastOptions;
          toast(<ToastContent notice={notice} />, options);
          return;
        }
        // No cap here: ToastContent's ledger closes the oldest through
        // `onDismiss`, the same way it closes a Connect toast.
        setNotices((prev) => [...prev, notice]);
      }),
    [toast],
  );

  if (notices.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {notices.map((n) => {
        const dismiss = () =>
          setNotices((prev) => prev.filter((x) => x.id !== n.id));
        return (
          <div key={n.id} className="bai-toast-card pointer-events-auto">
            <ToastContent notice={n} onDismiss={dismiss} />
            <button
              type="button"
              className="bai-toast-close"
              onClick={dismiss}
              aria-label="Dismiss"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="m3.5 3.5 7 7M10.5 3.5l-7 7" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
