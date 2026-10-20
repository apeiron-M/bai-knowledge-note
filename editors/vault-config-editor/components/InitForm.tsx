/**
 * First-run form — INITIALIZE_CONFIG.
 *
 * Shown while `name` is unset. Every other section needs a name and domain to
 * mean anything, so this gate comes before them rather than presenting eight
 * dimensions of an unnamed vault.
 */
import { useState } from "react";
import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type { VaultConfigAction } from "document-models/vault-config";
import { TOOLBAR_CLASS } from "../../shared/theme-context.js";
import { ts } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

export function InitForm({ dispatch }: { dispatch: Dispatch }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const ready = name.trim().length > 0 && domain.trim().length > 0;

  const fieldStyle = {
    backgroundColor: "var(--bai-bg)",
    color: "var(--bai-text-secondary)",
    border: "1px solid var(--bai-border)",
  } as const;

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--bai-bg)", color: "var(--bai-text)" }}
    >
      <div className="mx-auto max-w-2xl">
        <DocumentToolbar toolbarClassName={TOOLBAR_CLASS} />
        <div className="p-6">
          <div
            className="space-y-4 rounded-xl p-8"
            style={{
              backgroundColor: "var(--bai-surface)",
              border: "1px solid var(--bai-border)",
            }}
          >
            <div>
              <h2
                className="text-lg font-bold"
                style={{ color: "var(--bai-text)" }}
              >
                Name this vault
              </h2>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--bai-text-muted)" }}
              >
                The rest of the settings describe how it works. Start with what
                it is.
              </p>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vault name"
              aria-label="Vault name"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={fieldStyle}
            />
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="What this vault is about"
              aria-label="What this vault is about"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[#cba6f7]/50"
              style={fieldStyle}
            />
            <button
              type="button"
              disabled={!ready}
              onClick={() =>
                dispatch(
                  actions.initializeConfig({
                    name: name.trim(),
                    domain: domain.trim(),
                    updatedAt: ts(),
                  }),
                )
              }
              className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-80 disabled:opacity-40"
              style={{
                backgroundColor: "var(--bai-accent)",
                color: "var(--bai-accent-text)",
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
