/**
 * Extraction categories — ADD_EXTRACTION_CATEGORY + TOGGLE_EXTRACTION_CATEGORY.
 *
 * Neither operation had any UI, so this section is new. A category tells
 * extraction what to look for in a source. The model has no remove operation,
 * which suits config history: switching a category off keeps the record that it
 * once applied, so old notes stay explicable.
 */
import { useState } from "react";
import { generateId } from "document-model";
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import { actions } from "document-models/vault-config";
import type {
  ExtractionCategory,
  VaultConfigAction,
} from "document-models/vault-config";
import { Card, Empty, controlClass, controlStyle } from "./ui.js";

type Dispatch = DocumentDispatch<VaultConfigAction>;

export function ExtractionCategoriesSection({
  categories,
  dispatch,
}: {
  categories: ExtractionCategory[];
  dispatch: Dispatch;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const activeCount = categories.filter((c) => c.active).length;
  const canAdd = name.trim().length > 0 && description.trim().length > 0;

  function add() {
    if (!canAdd) return;
    dispatch(
      actions.addExtractionCategory({
        id: generateId(),
        name: name.trim(),
        description: description.trim(),
        active: true,
      }),
    );
    setName("");
    setDescription("");
  }

  return (
    <Card
      title={`Extraction categories (${activeCount} of ${categories.length} on)`}
      hint="What to look for when mining a source for claims."
    >
      {categories.length === 0 ? (
        <Empty>
          No categories yet, so extraction goes on the agent&apos;s judgement
          alone. Add one to tell it what to look for.
        </Empty>
      ) : (
        <div className="space-y-1.5">
          {categories.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2"
              style={{
                backgroundColor: "var(--bai-deep)",
                border: "1px solid var(--bai-border)",
              }}
            >
              <input
                type="checkbox"
                checked={c.active}
                onChange={(e) =>
                  dispatch(
                    actions.toggleExtractionCategory({
                      id: c.id,
                      active: e.target.checked,
                    }),
                  )
                }
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-xs font-medium"
                  style={{
                    color: c.active
                      ? "var(--bai-text-secondary)"
                      : "var(--bai-text-faint)",
                  }}
                >
                  {c.name}
                </span>
                <span
                  className="block text-[10px] leading-relaxed"
                  style={{ color: "var(--bai-text-faint)" }}
                >
                  {c.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          aria-label="Category name"
          className={`${controlClass} w-full`}
          style={controlStyle}
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="What it captures"
            aria-label="What the category captures"
            className={`${controlClass} flex-1`}
            style={controlStyle}
          />
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="shrink-0 rounded px-2.5 py-1 text-xs font-medium disabled:opacity-40"
            style={{
              backgroundColor: "var(--bai-accent)",
              color: "var(--bai-accent-text)",
            }}
          >
            Add
          </button>
        </div>
      </div>
    </Card>
  );
}
