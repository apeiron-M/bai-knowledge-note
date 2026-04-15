import { baseActions } from "document-model";
import { healthReportReportManagementActions } from "./gen/creators.js";

/** Actions for the HealthReport document model */

export const actions = {
  ...baseActions,
  ...healthReportReportManagementActions,
};
