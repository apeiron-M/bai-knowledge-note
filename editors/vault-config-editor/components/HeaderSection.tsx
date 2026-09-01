/**
 * Vault name and domain — INITIALIZE_CONFIG.
 *
 * The model has no separate rename operation, so INITIALIZE_CONFIG is also the
 * edit path. Its reducer only ever assigns name, domain and updatedAt, so
 * re-dispatching it is safe: nothing else in state is touched. Both fields are
 * passed on every write because the input requires both, and sending one alone
 * would blank the other.
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type { VaultConfigAction } from "document-models/vault-config";
import { ts } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

export function HeaderSection({
  name,
  domain,
  updatedAt,
  dispatch,
}: {
  name: string;
  domain: string;
  updatedAt: string | null;
  dispatch: Dispatch;
}) {
  const save = (next: { name?: string; domain?: string }) =>
    dispatch(
      actions.initializeConfig({
        name: next.name ?? name,
        domain: next.domain ?? domain,
        updatedAt: ts(),
      }),
    );

  return (
    <div
      className="rounded-xl p-6"
      style={{
        backgroundColor: "var(--bai-surface)",
        border: "1px solid var(--bai-border)",
      }}
    >
      <input
        type="text"
        defaultValue={name}
        placeholder="Vault name"
        aria-label="Vault name"
        onBlur={(e) => {
          const next = e.target.value.trim();
          // The name titles the whole panel; an empty one would leave it
          // headless, so restore instead of storing a blank.
          if (!next) {
            e.currentTarget.value = name;
            return;
          }
          if (next !== name) save({ name: next });
        }}
        className="w-full border-0 bg-transparent text-xl font-bold outline-none"
        style={{ color: "var(--bai-text)" }}
      />
      <input
        type="text"
        defaultValue={domain}
        placeholder="What this vault is about"
        aria-label="What this vault is about"
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (!next) {
            e.currentTarget.value = domain;
            return;
          }
          if (next !== domain) save({ domain: next });
        }}
        className="mt-1 w-full border-0 bg-transparent text-sm outline-none"
        style={{ color: "var(--bai-text-muted)" }}
      />
      {updatedAt && (
        <p
          className="mt-1 text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          Last changed {new Date(updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
