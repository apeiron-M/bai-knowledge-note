import { useRef, useState } from "react";
import { Spinner } from "../LoadingStates.js";
import { LandingStage } from "./LandingStage.js";

/**
 * Shown until a key exists. Says what connecting does, in the user's terms:
 * the vault is only ever read, and the key stays in this browser.
 *
 * The primary button is the glow's anchor. The paste-a-key disclosure lives in
 * the stage's tail so opening it grows downward without moving the button.
 */
export function ChatConnectPanel({
  vaultName,
  busy,
  onConnect,
  onConnectWithKey,
}: {
  vaultName: string;
  /** True while a redirect's code exchange is finishing. */
  busy: boolean;
  onConnect: () => void;
  onConnectWithKey: (key: string) => Promise<boolean>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitKey() {
    if (!key.trim() || checking) return;
    setChecking(true);
    setError(null);
    const ok = await onConnectWithKey(key);
    setChecking(false);
    if (!ok)
      setError("OpenRouter did not accept that key. Check it and try again.");
  }

  if (busy) {
    return (
      <LandingStage anchorRef={anchorRef}>
        <div
          ref={anchorRef}
          className="flex flex-col items-center gap-3 text-sm"
          style={{ color: "var(--bai-text-muted)" }}
        >
          <Spinner />
          Finishing sign-in…
        </div>
      </LandingStage>
    );
  }

  const tail = (
    <div className="flex w-full max-w-md flex-col items-center pt-6">
      <button
        type="button"
        onClick={() => setShowKey((v) => !v)}
        className="text-xs underline decoration-dotted underline-offset-4"
        style={{ color: "var(--bai-text-muted)" }}
        aria-expanded={showKey}
      >
        {showKey ? "Hide" : "I already have an OpenRouter key"}
      </button>

      {showKey && (
        <div className="mt-3 flex w-full flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submitKey()}
              placeholder="sk-or-v1-…"
              aria-label="OpenRouter API key"
              autoComplete="off"
              autoFocus
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--bai-accent)]"
              style={{
                backgroundColor: "var(--bai-bg)",
                border: "1px solid var(--bai-border)",
                color: "var(--bai-text)",
              }}
            />
            <button
              type="button"
              onClick={() => void submitKey()}
              disabled={!key.trim() || checking}
              className="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-hover)",
                color: "var(--bai-text)",
              }}
            >
              {checking ? <Spinner className="h-3.5 w-3.5" /> : "Use key"}
            </button>
          </div>
          {error && (
            <p className="text-left text-xs" style={{ color: "#ef4444" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <LandingStage anchorRef={anchorRef} tail={tail}>
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <svg
          className="mb-5 h-10 w-10"
          style={{ color: "var(--bai-accent)" }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
        </svg>
        <h2
          className="text-xl font-semibold tracking-tight"
          style={{ color: "var(--bai-text)" }}
        >
          Chat with {vaultName}
        </h2>
        <p
          className="mt-2 text-sm leading-relaxed"
          style={{ color: "var(--bai-text-muted)" }}
        >
          Connect a model through OpenRouter and ask questions in plain
          language. The model reads your notes and cites the ones it used — it
          can never change anything in the vault.
        </p>

        <div ref={anchorRef} className="mt-6">
          <button
            type="button"
            onClick={onConnect}
            className="rounded-full px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            Connect with OpenRouter
          </button>
        </div>

        <p
          className="mt-3 text-[11px] leading-relaxed"
          style={{ color: "var(--bai-text-faint)" }}
        >
          You sign in on openrouter.ai and come straight back. Your key is
          stored only in this browser and can be removed with Disconnect.
        </p>
      </div>
    </LandingStage>
  );
}
