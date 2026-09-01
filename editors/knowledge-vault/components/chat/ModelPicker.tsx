import { useMemo, useState } from "react";
import type { ModelInfo } from "../../hooks/use-openrouter.js";

function price(perToken: number): string {
  if (perToken === 0) return "free";
  const perMillion = perToken * 1_000_000;
  return perMillion < 1
    ? `$${perMillion.toFixed(2)}/M`
    : `$${perMillion.toFixed(0)}/M`;
}

function contextLabel(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M ctx`;
  if (n >= 1000) return `${Math.round(n / 1000)}k ctx`;
  return n ? `${n} ctx` : "";
}

/**
 * Searchable picker over the live tool-capable catalog. The catalog changes
 * weekly, so nothing here is hardcoded; the current id is shown even while
 * the list is still loading.
 */
export function ModelPicker({
  model,
  models,
  loading,
  fellBack,
  onChange,
}: {
  model: string;
  models: ModelInfo[];
  loading: boolean;
  fellBack: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const current = models.find((m) => m.id === model);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
        )
      : models;
    return list.slice(0, 60);
  }, [models, filter]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[260px] items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--bai-hover)]"
        style={{ color: fellBack ? "#f59e0b" : "var(--bai-text-tertiary)" }}
        title={
          fellBack
            ? "Your previous model is no longer available; using the default."
            : "Choose a model"
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg
          className="h-3.5 w-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2a4 4 0 014 4v1h1a3 3 0 013 3v1a3 3 0 01-3 3h-1v1a4 4 0 01-8 0v-1H7a3 3 0 01-3-3v-1a3 3 0 013-3h1V6a4 4 0 014-4z" />
        </svg>
        <span className="truncate">{current?.name ?? model}</span>
        <svg
          className="h-3 w-3 shrink-0 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-1 flex w-96 flex-col rounded-lg shadow-xl"
            style={{
              border: "1px solid var(--bai-border)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={
                loading ? "Loading models…" : `Search ${models.length} models…`
              }
              aria-label="Search models"
              className="m-2 rounded-md px-3 py-1.5 text-xs outline-none focus:border-[var(--bai-accent)]"
              style={{
                backgroundColor: "var(--bai-bg)",
                border: "1px solid var(--bai-border)",
                color: "var(--bai-text)",
              }}
            />
            <ul role="listbox" className="max-h-72 overflow-auto pb-1">
              {shown.length === 0 && (
                <li
                  className="px-3 py-3 text-center text-xs"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {loading ? "Loading…" : "No models match"}
                </li>
              )}
              {shown.map((m) => {
                const selected = m.id === model;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setFilter("");
                      }}
                      className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--bai-hover)]"
                      style={{
                        color: selected
                          ? "var(--bai-accent)"
                          : "var(--bai-text-secondary)",
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {m.name}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[10px]"
                        style={{ color: "var(--bai-text-faint)" }}
                      >
                        {contextLabel(m.contextLength)} · {price(m.promptPrice)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
