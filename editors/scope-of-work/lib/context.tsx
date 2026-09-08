import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import type {
  ScopeOfWorkAction,
  ScopeOfWorkState,
} from "document-models/scope-of-work";
import { createContext, useContext } from "react";
import type { View } from "./model.js";
import type { InspectorLayout } from "./prefs.js";

export type Dispatch = (
  action: ScopeOfWorkAction | ScopeOfWorkAction[],
) => void;

export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
};

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export type EditorContextValue = {
  /** This scope-of-work document's id — what a linked WBS points back at. */
  documentId: string;
  state: ScopeOfWorkState;
  /** Dispatches and routes reducer errors to the shell's error banner. */
  dispatch: Dispatch;
  view: View;
  go: (view: View) => void;
  selected: string | null;
  select: (deliverableId: string | null) => void;
  today: Date;
  /** How the deliverable inspector opens. Remembered per browser. */
  inspectorLayout: InspectorLayout;
  toggleInspectorLayout: () => void;
  /** In-editor confirmation. Resolves true if the person confirms. */
  confirm: ConfirmFn;
};

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx)
    throw new Error("useEditor must be used inside <EditorContext.Provider>");
  return ctx;
}

/**
 * Adapts the reactor's dispatch: batches arrays and forwards errors to a reporter.
 * Reducer rejections are recorded on the resulting operations rather than thrown, and the
 * document Connect hands the editor carries no operation log — so the result passed to
 * `onSuccess` is the only place they can be read.
 */
export function makeDispatch(
  raw: DocumentDispatch<ScopeOfWorkAction>,
  report: (message: string) => void,
): Dispatch {
  return (action) => {
    const count = Array.isArray(action) ? action.length : 1;
    raw(
      action,
      (errors) => report(errors.map((e) => e.message).join(" · ")),
      (result) => {
        const ops: unknown = (result as { operations?: { global?: unknown } })
          .operations?.global;
        if (!Array.isArray(ops)) return;
        for (const op of ops.slice(-count)) {
          const e: unknown =
            typeof op === "object" && op !== null
              ? (op as { error?: unknown }).error
              : undefined;
          if (typeof e === "string" && e !== "") {
            report(e);
            return;
          }
        }
      },
    );
  };
}
