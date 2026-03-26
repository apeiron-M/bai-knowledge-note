import type { PHDocument, PHBaseState } from "document-model";
import type { HealthReportAction } from "./actions.js";
import type { HealthReportState as HealthReportGlobalState } from "./schema/types.js";

type HealthReportLocalState = Record<PropertyKey, never>;

type HealthReportPHState = PHBaseState & {
  global: HealthReportGlobalState;
  local: HealthReportLocalState;
};
type HealthReportDocument = PHDocument<HealthReportPHState>;

export * from "./schema/types.js";

export type {
  HealthReportGlobalState,
  HealthReportLocalState,
  HealthReportPHState,
  HealthReportAction,
  HealthReportDocument,
};
