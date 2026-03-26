import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  id: "bai/health-report",
  name: "HealthReport",
  author: {
    name: "BAI",
    website: "https://bai.dev",
  },
  extension: "hr.phd",
  description:
    "Vault diagnostics \u2014 point-in-time health report with graph metrics, check results, and recommendations.",
  specifications: [
    {
      state: {
        local: {
          schema: "",
          examples: [],
          initialValue: "",
        },
        global: {
          schema:
            "enum HealthStatus {\n    PASS\n    WARN\n    FAIL\n}\n\nenum HealthCategory {\n    SCHEMA_COMPLIANCE\n    ORPHAN_DETECTION\n    LINK_HEALTH\n    DESCRIPTION_QUALITY\n    THREE_SPACE_BOUNDARIES\n    PROCESSING_THROUGHPUT\n    STALE_NOTES\n    MOC_COHERENCE\n}\n\ntype HealthCheck {\n    id: OID!\n    category: HealthCategory!\n    status: HealthStatus!\n    message: String!\n    affectedItems: [String!]!\n}\n\ntype GraphMetrics {\n    noteCount: Int!\n    mocCount: Int!\n    connectionCount: Int!\n    density: Float!\n    orphanCount: Int!\n    danglingLinkCount: Int!\n    mocCoverage: Float!\n    averageLinksPerNote: Float!\n}\n\ntype HealthReportState {\n    generatedAt: DateTime\n    generatedBy: String\n    mode: String\n    overallStatus: HealthStatus\n    checks: [HealthCheck!]!\n    graphMetrics: GraphMetrics\n    recommendations: [String!]!\n}",
          examples: [],
          initialValue:
            '{\n    "generatedAt": null,\n    "generatedBy": null,\n    "mode": null,\n    "overallStatus": null,\n    "checks": [],\n    "graphMetrics": null,\n    "recommendations": []\n}',
        },
      },
      modules: [
        {
          id: "report-management",
          name: "report-management",
          description: "Health report generation",
          operations: [
            {
              id: "generate-report",
              name: "GENERATE_REPORT",
              description: "Generate a health report",
              schema:
                "input GraphMetricsInput {\n    noteCount: Int!\n    mocCount: Int!\n    connectionCount: Int!\n    density: Float!\n    orphanCount: Int!\n    danglingLinkCount: Int!\n    mocCoverage: Float!\n    averageLinksPerNote: Float!\n}\n\ninput GenerateReportInput {\n    generatedAt: DateTime!\n    generatedBy: String\n    mode: String!\n    overallStatus: HealthStatus!\n    graphMetrics: GraphMetricsInput!\n    recommendations: [String!]!\n}",
              template: "Generate a health report",
              reducer:
                "state.generatedAt = action.input.generatedAt;\nstate.generatedBy = action.input.generatedBy || null;\nstate.mode = action.input.mode;\nstate.overallStatus = action.input.overallStatus;\nstate.graphMetrics = action.input.graphMetrics;\nstate.recommendations = action.input.recommendations;\nstate.checks = [];",
              errors: [],
              examples: [],
              scope: "global",
            },
            {
              id: "add-check",
              name: "ADD_CHECK",
              description: "Add a health check result",
              schema:
                "input AddCheckInput {\n    id: OID!\n    category: HealthCategory!\n    status: HealthStatus!\n    message: String!\n    affectedItems: [String!]!\n}",
              template: "Add a health check result",
              reducer:
                "state.checks.push({\n    id: action.input.id,\n    category: action.input.category,\n    status: action.input.status,\n    message: action.input.message,\n    affectedItems: action.input.affectedItems,\n});",
              errors: [],
              examples: [],
              scope: "global",
            },
          ],
        },
      ],
      version: 1,
      changeLog: [],
    },
  ],
};
