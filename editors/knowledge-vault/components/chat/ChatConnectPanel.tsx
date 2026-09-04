import { useRef, useState } from "react";
import { SIGN_UP_URL } from "../../lib/chat/openrouter-auth.js";
import { normalizeBaseUrl } from "../../lib/chat/provider.js";
import type {
  CustomEndpointInput,
  SavedConnection,
} from "../../hooks/use-chat-provider.js";
import type { ProviderKind } from "../../lib/chat/provider.js";
import { Spinner } from "../LoadingStates.js";
import { LandingStage } from "./LandingStage.js";

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--bai-accent)]";
const inputStyle = {
  backgroundColor: "var(--bai-bg)",
  border: "1px solid var(--bai-border)",
  color: "var(--bai-text)",
} as const;

/**
 * Shown until a model endpoint is connected. Three ways in, in the order most
 * people want them: OpenRouter (sign in, come straight back), Connect's own AI
 * settings when this browser already has them, or any OpenAI-compatible
 * server by address — Ollama, LM Studio, vLLM, a gateway. Whatever the route,
 * the vault is only ever read and the key never leaves this browser.
 *
 * The primary button is the glow's anchor. The disclosures live in the
 * stage's tail so opening one grows downward without moving the button.
 */
export function ChatConnectPanel({
  vaultName,
  busy,
  interrupted = false,
  onConnect,
  onConnectWithKey,
  onConnectCustom,
  connectSettings,
  onUseConnectSettings,
  saved,
  onUseSaved,
}: {
  vaultName: string;
  /** True while a redirect's code exchange is finishing. */
  busy: boolean;
  /** The user started Connect and came back without finishing — see useChatProvider. */
  interrupted?: boolean;
  onConnect: () => void;
  onConnectWithKey: (key: string) => Promise<boolean>;
  /** Resolves to null on success, else a message saying what went wrong. */
  onConnectCustom: (input: CustomEndpointInput) => Promise<string | null>;
  /** Connect's own AI endpoint, when configured in this browser. */
  connectSettings: { host: string; model: string } | null;
  onUseConnectSettings: () => void;
  /** Connections this browser remembers; one click reactivates one. */
  saved?: SavedConnection[];
  onUseSaved?: (kind: ProviderKind) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCustom, setShowCustom] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [extraBody, setExtraBody] = useState("");
  const [disableThinking, setDisableThinking] = useState(true);
  const [customBusy, setCustomBusy] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  async function submitKey() {
    if (!key.trim() || checking) return;
    setChecking(true);
    setError(null);
    const ok = await onConnectWithKey(key);
    setChecking(false);
    if (!ok)
      setError("OpenRouter did not accept that key. Check it and try again.");
  }

  async function submitCustom() {
    if (!baseUrl.trim() || customBusy) return;
    setCustomBusy(true);
    setCustomError(null);
    const problem = await onConnectCustom({ baseUrl, apiKey, model, extraBody, disableThinking });
    setCustomBusy(false);
    if (problem) setCustomError(problem);
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

  const resolvedBase = normalizeBaseUrl(baseUrl);
  const origin = typeof location === "undefined" ? "this app" : location.origin;

  const tail = (
    <div className="flex w-full max-w-md flex-col items-center gap-3 pt-6">
      {saved && saved.length > 0 && onUseSaved && (
        <div className="flex w-full flex-col gap-1.5">
          <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--bai-text-faint)" }}>
            Saved connections
          </p>
          {saved.map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => onUseSaved(c.kind)}
              className="flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bai-hover)]"
              style={{ border: "1px solid var(--bai-border)", color: "var(--bai-text-secondary)" }}
            >
              <span className="font-medium" style={{ color: "var(--bai-text)" }}>
                {c.label}
              </span>
              {c.model && <span className="truncate font-mono text-[10px]">{c.model}</span>}
              <span className="ml-auto shrink-0" style={{ color: "var(--bai-accent)" }}>
                Use →
              </span>
            </button>
          ))}
        </div>
      )}
      <p
        className="text-center text-xs leading-relaxed"
        style={{ color: "var(--bai-text-muted)" }}
      >
        New to OpenRouter?{" "}
        <a
          href={SIGN_UP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-4"
          style={{ color: "var(--bai-text-secondary)" }}
        >
          Create an account
        </a>{" "}
        — it opens in a new tab, so this one stays put. Then come back and click
        Connect.
      </p>
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
        <div className="mt-1 flex w-full flex-col gap-2">
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
              className={`flex-1 ${inputClass}`}
              style={inputStyle}
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

      <div
        className="my-2 flex w-full items-center gap-3 text-[11px] uppercase tracking-wide"
        style={{ color: "var(--bai-text-faint)" }}
        aria-hidden
      >
        <span className="h-px flex-1" style={{ backgroundColor: "var(--bai-border)" }} />
        or bring your own model
        <span className="h-px flex-1" style={{ backgroundColor: "var(--bai-border)" }} />
      </div>

      {connectSettings && (
        <button
          type="button"
          onClick={onUseConnectSettings}
          className="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-[var(--bai-hover)]"
          style={{ border: "1px solid var(--bai-border)", color: "var(--bai-text-secondary)" }}
          title="Use the endpoint configured under Connect › Settings › AI assistant"
        >
          <span className="font-medium" style={{ color: "var(--bai-text)" }}>
            Use Connect&apos;s AI settings
          </span>{" "}
          — {connectSettings.model} at {connectSettings.host}
        </button>
      )}

      <button
        type="button"
        onClick={() => setShowCustom((v) => !v)}
        className="text-xs underline decoration-dotted underline-offset-4"
        style={{ color: "var(--bai-text-muted)" }}
        aria-expanded={showCustom}
      >
        {showCustom
          ? "Hide"
          : "Use my own endpoint — Ollama, LM Studio, vLLM, any OpenAI-compatible server"}
      </button>

      {showCustom && (
        <form
          className="flex w-full flex-col gap-2 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCustom();
          }}
        >
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
            Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              aria-label="Base URL of an OpenAI-compatible API"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className={inputClass}
              style={inputStyle}
            />
            {resolvedBase && (
              <span className="font-mono text-[10px]" style={{ color: "var(--bai-text-faint)" }}>
                → {resolvedBase}/chat/completions
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
              API key <span style={{ color: "var(--bai-text-faint)" }}>(if the server needs one)</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="optional"
                aria-label="API key"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
              Model <span style={{ color: "var(--bai-text-faint)" }}>(or pick from its list)</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. llama3.1"
                aria-label="Model id"
                autoComplete="off"
                spellCheck={false}
                className={inputClass}
                style={inputStyle}
              />
            </label>
          </div>
          <label
            className="flex items-start gap-2 text-[11px] leading-relaxed"
            style={{ color: "var(--bai-text-muted)" }}
          >
            <input
              type="checkbox"
              checked={disableThinking}
              onChange={(e) => setDisableThinking(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Turn the model&apos;s thinking off — reasoning models (Qwen3, DeepSeek)
              otherwise think before every tool round, which is slow on a local
              machine. You can switch it back on from the endpoint menu.
            </span>
          </label>
          <button
            type="button"
            onClick={() => setShowExtra((v) => !v)}
            className="self-start text-[11px] underline decoration-dotted underline-offset-4"
            style={{ color: "var(--bai-text-muted)" }}
            aria-expanded={showExtra}
          >
            {showExtra ? "Hide extra request fields" : "Extra request fields (advanced)"}
          </button>
          {showExtra && (
            <label className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
              JSON merged into every request — the server&apos;s own knobs
              <textarea
                value={extraBody}
                onChange={(e) => setExtraBody(e.target.value)}
                placeholder='{"enable_thinking": false, "temperature": 0.7}'
                aria-label="Extra request fields as JSON"
                rows={2}
                spellCheck={false}
                className={`${inputClass} font-mono`}
                style={inputStyle}
              />
            </label>
          )}
          <button
            type="submit"
            disabled={!baseUrl.trim() || customBusy}
            className="self-end rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: "var(--bai-hover)", color: "var(--bai-text)" }}
          >
            {customBusy ? <Spinner className="h-3.5 w-3.5" /> : "Connect"}
          </button>
          {customError && (
            <p className="text-xs leading-relaxed" role="alert" style={{ color: "#ef4444" }}>
              {customError}
            </p>
          )}
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--bai-text-faint)" }}>
            The request goes straight from this browser to your server, so the
            server has to allow the origin <span className="font-mono">{origin}</span>.
            Ollama: start it with{" "}
            <span className="font-mono">OLLAMA_ORIGINS=&quot;{origin}&quot;</span> · LM Studio:
            enable CORS in the server tab · vLLM / llama.cpp: pass their
            <span className="font-mono"> --allowed-origins</span> / CORS flag. The model must
            support tool calling for the vault tools to work.
          </p>
        </form>
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
          Connect a model — through OpenRouter, or one running on your own
          machine — and ask questions in plain language. The model reads your
          notes and cites the ones it used; it can never change anything in the
          vault.
        </p>

        {interrupted && (
          <p
            className="mt-5 max-w-sm rounded-lg px-3 py-2 text-xs leading-relaxed"
            style={{
              backgroundColor: "var(--bai-accent-soft)",
              color: "var(--bai-text-secondary)",
              border: "1px solid var(--bai-border)",
            }}
            role="status"
          >
            Looks like the sign-in didn&apos;t finish — that happens when you
            create a new OpenRouter account along the way. You&apos;re signed in
            now, so click <span className="font-semibold">Connect</span> once
            more and you&apos;ll come straight back.
          </p>
        )}

        <div ref={anchorRef} className={interrupted ? "mt-4" : "mt-6"}>
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
          You sign in on openrouter.ai and come straight back. Keys and
          addresses are stored only in this browser and removed with Disconnect.
        </p>
      </div>
    </LandingStage>
  );
}
