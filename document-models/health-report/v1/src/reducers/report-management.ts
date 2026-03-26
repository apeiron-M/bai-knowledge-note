import type { HealthReportReportManagementOperations } from "knowledge-note/document-models/health-report/v1";

export const healthReportReportManagementOperations: HealthReportReportManagementOperations =
  {
    generateReportOperation(state, action) {
      state.generatedAt = action.input.generatedAt;
      state.generatedBy = action.input.generatedBy || null;
      state.mode = action.input.mode;
      state.overallStatus = action.input.overallStatus;
      state.graphMetrics = action.input.graphMetrics;
      state.recommendations = action.input.recommendations;
      state.checks = [];
    },
    addCheckOperation(state, action) {
      state.checks.push({
        id: action.input.id,
        category: action.input.category,
        status: action.input.status,
        message: action.input.message,
        affectedItems: action.input.affectedItems,
      });
    },
  };
