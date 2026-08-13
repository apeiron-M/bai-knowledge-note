import {
  addCheck,
  generateReport,
  isHealthReportDocument,
  reducer,
  utils,
} from "document-models/health-report/v1";
import { describe, expect, it } from "vitest";

const graphMetrics = {
  noteCount: 94,
  connectionCount: 210,
  averageLinksPerNote: 2.2,
  density: 0.05,
  orphanCount: 3,
  danglingLinkCount: 1,
  mocCount: 7,
  mocCoverage: 0.85,
};

describe("ReportManagement scenarios", () => {
  it("should generate a report with generatedBy, add checks, then regenerate without generatedBy", () => {
    let document = utils.createDocument();

    // generatedBy provided → stored as-is
    document = reducer(
      document,
      generateReport({
        generatedAt: "2026-01-01T00:00:00.000Z",
        generatedBy: "health-agent",
        mode: "full",
        overallStatus: "WARN",
        graphMetrics,
        recommendations: ["Link orphan notes"],
      }),
    );
    expect(document.state.global.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(document.state.global.generatedBy).toBe("health-agent");
    expect(document.state.global.mode).toBe("full");
    expect(document.state.global.overallStatus).toBe("WARN");
    expect(document.state.global.graphMetrics).toStrictEqual(graphMetrics);
    expect(document.state.global.recommendations).toStrictEqual([
      "Link orphan notes",
    ]);
    expect(document.state.global.checks).toStrictEqual([]);

    document = reducer(
      document,
      addCheck({
        id: "check-1",
        category: "ORPHAN_DETECTION",
        status: "WARN",
        message: "3 orphan notes found",
        affectedItems: ["note-a", "note-b", "note-c"],
      }),
    );
    document = reducer(
      document,
      addCheck({
        id: "check-2",
        category: "LINK_HEALTH",
        status: "PASS",
        message: "All links resolve",
        affectedItems: [],
      }),
    );
    expect(document.state.global.checks).toHaveLength(2);
    expect(document.state.global.checks[0]).toStrictEqual({
      id: "check-1",
      category: "ORPHAN_DETECTION",
      status: "WARN",
      message: "3 orphan notes found",
      affectedItems: ["note-a", "note-b", "note-c"],
    });

    // generatedBy omitted → falls back to null, checks are reset
    document = reducer(
      document,
      generateReport({
        generatedAt: "2026-01-02T00:00:00.000Z",
        mode: "quick",
        overallStatus: "PASS",
        graphMetrics,
        recommendations: [],
      }),
    );
    expect(isHealthReportDocument(document)).toBe(true);
    expect(document.state.global.generatedBy).toBeNull();
    expect(document.state.global.generatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(document.state.global.checks).toStrictEqual([]);
    expect(document.state.global.recommendations).toStrictEqual([]);

    expect(document.operations.global).toHaveLength(4);
    for (const operation of document.operations.global) {
      expect(operation.error).toBeUndefined();
    }
  });
});
