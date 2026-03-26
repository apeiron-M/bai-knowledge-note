import type { PHDocument, PHBaseState } from "document-model";
import type { MocAction } from "./actions.js";
import type { MocState as MocGlobalState } from "./schema/types.js";

type MocLocalState = Record<PropertyKey, never>;

type MocPHState = PHBaseState & {
  global: MocGlobalState;
  local: MocLocalState;
};
type MocDocument = PHDocument<MocPHState>;

export * from "./schema/types.js";

export type {
  MocGlobalState,
  MocLocalState,
  MocPHState,
  MocAction,
  MocDocument,
};
