/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
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
  HealthReportAction,
  HealthReportDocument,
  HealthReportGlobalState,
  HealthReportLocalState,
  HealthReportPHState,
};
