import { useState } from "react";
import type { ChatLlm } from "../hooks/use-chat-llm.js";

const fieldStyle = {
  border: "1px solid var(--bai-border)",
  backgroundColor: "var(--bai-surface)",
  color: "var(--bai-text)",
} as const;
const buttonStyle = { border: "1px solid var(--bai-border)" } as const;

/**
 * Model settings for configuration C: where the two GGUFs come from, the
 * decision-model toggle (default on), unloading it, clearing the OPFS model
 * cache, and (dev only) the trie mode and the in-browser parity check.
 */
export function ChatModelSettings({ llm }: { llm: ChatLlm }) {
  const { settings, sources } = llm;
  const [base, setBase] = useState(settings.baseUrl ?? "");
  const [loraUrl, setLoraUrl] = useState(settings.loraUrl ?? "");
  const [kevUrl, setKevUrl] = useState(settings.kevUrl ?? "");
  const [note, setNote] = useState<string | null>(null);
  const lowMemory = llm.deviceMemoryGb !== null && llm.deviceMemoryGb < 16;
  const kevLoaded = llm.kev.phase !== "idle" && llm.kev.phase !== "off";

  async function run(label: string, fn: () => Promise<string>) {
    setNote(`${label}...`);
    try {
      setNote(await fn());
    } catch (err) {
      setNote(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <details className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
      <summary className="cursor-pointer">Model settings</summary>
      <div className="mt-2 flex flex-col gap-2">
        <div>
          Command model: <span data-testid="chat-lora-source">{sources.lora.label}</span>
          <br />
          Decision model: <span data-testid="chat-kev-source">{sources.kev.label}</span>
        </div>
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            llm.setSettings({ baseUrl: base, loraUrl, kevUrl });
            setNote("Saved in this browser; models load on the next message.");
          }}
        >
          <input
            aria-label="Model base URL"
            name="chat-model-base-url"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="Model base URL (<base>/<file name> for both; empty = this origin's dev paths)"
            className="rounded-md px-2 py-1"
            style={fieldStyle}
          />
          <input
            aria-label="Command model GGUF URL"
            name="chat-lora-url"
            value={loraUrl}
            onChange={(e) => setLoraUrl(e.target.value)}
            placeholder="Command model URL override (optional)"
            className="rounded-md px-2 py-1"
            style={fieldStyle}
          />
          <input
            aria-label="Decision model GGUF URL"
            name="chat-kev-url"
            value={kevUrl}
            onChange={(e) => setKevUrl(e.target.value)}
            placeholder="Decision model URL override (optional)"
            className="rounded-md px-2 py-1"
            style={fieldStyle}
          />
          <div>
            <button type="submit" className="rounded-md px-3 py-1" style={buttonStyle}>
              Use
            </button>{" "}
            A host needs CORS for this origin and HTTP Range support.
          </div>
        </form>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="chat-use-kev"
            checked={settings.useKev}
            onChange={(e) => llm.setSettings({ useKev: e.target.checked })}
          />
          Use decision model (Kev-FT). Both models take about 4.5–5 GB of memory
          (Phase 0); without it the tab runs the LoRA alone and never asks.
        </label>
        {lowMemory && settings.useKev && (
          <div style={{ color: "#d97706" }}>
            This device reports {llm.deviceMemoryGb} GB of memory; the decision model
            may not fit. Turn it off if the tab crashes.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="chat-unload-kev"
            disabled={!kevLoaded}
            onClick={() =>
              void run("Unloading the decision model", async () => {
                await llm.unloadKev();
                return "Decision model unloaded; it loads again on the next request to a document.";
              })
            }
            className="rounded-md px-3 py-1 disabled:opacity-50"
            style={buttonStyle}
          >
            Unload decision model
          </button>
          <button
            type="button"
            data-testid="chat-clear-cache"
            onClick={() =>
              void run("Clearing cached models", async () => {
                await llm.clearCache();
                return "Cached models cleared; loaded models stay in memory until reload.";
              })
            }
            className="rounded-md px-3 py-1"
            style={buttonStyle}
          >
            Clear cached models
          </button>
        </div>
        {llm.debug && (
          <div className="flex flex-wrap items-center gap-2">
            <label>
              Trie{" "}
              <select
                aria-label="Trie mode"
                value={settings.trieMode}
                onChange={(e) =>
                  llm.setSettings({ trieMode: e.target.value === "exact" ? "exact" : "branch" })
                }
                className="rounded-md px-1"
                style={fieldStyle}
              >
                <option value="branch">branch (shipped)</option>
                <option value="exact">exact (as registered)</option>
              </select>
            </label>
            <button
              type="button"
              data-testid="chat-run-parity"
              onClick={() =>
                void run("Running the parity check", async () => {
                  const r = await llm.runParity();
                  const s = r.summary;
                  return `Parity (${r.mode}) ${s.pass ? "PASS" : "FAIL"}: gate ${s.gateSame}/${s.gateTotal}, args ${s.argsSame}/${s.argsTotal}, Kev max |dp| ${s.maxDKevP.toFixed(4)}, trie median |d| ${s.medianDLora.toFixed(3)} nat (max ${s.maxDLora.toFixed(3)}), errors ${s.errors}. Full report: await window.__baiChatParityC()`;
                })
              }
              className="rounded-md px-3 py-1"
              style={buttonStyle}
            >
              Run parity check
            </button>
          </div>
        )}
        {note && <div data-testid="chat-settings-note">{note}</div>}
      </div>
    </details>
  );
}
