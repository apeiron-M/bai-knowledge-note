import { useId, useState, type KeyboardEvent } from "react";
import type { FoundNode } from "./model.js";

/*
 * Find a note or topic on the graph. From the second character it lists up
 * to eight nodes whose title contains the text; Enter or a click chooses one
 * (the view moves to it and it is selected, as a click on the canvas does),
 * the arrow keys move through the list, and Esc clears the box.
 */
export function GraphFind(props: {
  search: (query: string) => FoundNode[];
  onChoose: (id: string) => void;
  /** The text the box starts with (for tests). */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = props.search(query);
  const current = Math.min(active, Math.max(0, results.length - 1));
  const optionId = (i: number) => `${listId}-${i}`;

  function clear() {
    setQuery("");
    setActive(0);
  }
  function choose(found: FoundNode) {
    props.onChoose(found.id);
    clear();
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      clear();
      return;
    }
    if (e.key === "Enter") {
      const found = results[current];
      if (found) {
        e.preventDefault();
        choose(found);
      }
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + results.length) % results.length);
    }
  }

  return (
    <div className="absolute left-3 top-3 z-20 w-64">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Find a note or topic"
        aria-label="Find a note or topic"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          results.length > 0 ? optionId(current) : undefined
        }
        spellCheck={false}
        className="h-8 w-full rounded-md px-2.5 text-xs outline-none backdrop-blur-sm"
        style={{
          backgroundColor:
            "color-mix(in srgb, var(--bai-bg, #11111b) 90%, transparent)",
          color: "var(--bai-text, #e4e4e7)",
          border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
        }}
      />
      {results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching notes and topics"
          className="mt-1 overflow-hidden rounded-md text-xs shadow-lg"
          style={{
            backgroundColor: "var(--bai-surface, #181825)",
            border: "1px solid var(--bai-border, rgba(255,255,255,0.1))",
          }}
        >
          {results.map((found, i) => (
            <li
              key={found.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === current}
              data-node-id={found.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => {
                if (i !== current) setActive(i);
              }}
              onClick={() => choose(found)}
              className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5"
              style={{
                backgroundColor:
                  i === current
                    ? "color-mix(in srgb, var(--bai-accent, #cba6f7) 18%, transparent)"
                    : "transparent",
                color: "var(--bai-text, #e4e4e7)",
              }}
            >
              <span className="truncate">{found.label}</span>
              {found.isMoc && (
                <span
                  className="shrink-0 text-[10px]"
                  style={{ color: "var(--bai-text-muted, #9ca3af)" }}
                >
                  topic
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
