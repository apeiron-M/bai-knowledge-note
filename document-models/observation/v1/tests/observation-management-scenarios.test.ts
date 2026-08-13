import {
  archiveObservation,
  createObservation,
  implementObservation,
  isObservationDocument,
  promoteObservation,
  reducer,
  utils,
} from "document-models/observation/v1";
import { describe, expect, it } from "vitest";

describe("ObservationManagement scenarios", () => {
  it("should run the full observation lifecycle with optional fields provided", () => {
    let document = utils.createDocument();

    document = reducer(
      document,
      createObservation({
        title: "Reflect skips new notes",
        description: "Reflect pass misses notes created in the same session",
        content: "Observed during batch 12 processing",
        category: "FRICTION",
        observedAt: "2026-01-01T00:00:00.000Z",
        observedBy: "pipeline-agent",
      }),
    );
    expect(document.state.global.title).toBe("Reflect skips new notes");
    expect(document.state.global.description).toBe(
      "Reflect pass misses notes created in the same session",
    );
    expect(document.state.global.content).toBe(
      "Observed during batch 12 processing",
    );
    expect(document.state.global.category).toBe("FRICTION");
    expect(document.state.global.status).toBe("PENDING");
    expect(document.state.global.observedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(document.state.global.observedBy).toBe("pipeline-agent");

    document = reducer(
      document,
      promoteObservation({
        promotedTo: "methodology/reflect-ordering.md",
        promotedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    expect(document.state.global.status).toBe("PROMOTED");
    expect(document.state.global.promotedTo).toBe(
      "methodology/reflect-ordering.md",
    );
    expect(document.state.global.promotedAt).toBe("2026-01-02T00:00:00.000Z");

    document = reducer(
      document,
      implementObservation({ updatedAt: "2026-01-03T00:00:00.000Z" }),
    );
    expect(document.state.global.status).toBe("IMPLEMENTED");

    document = reducer(
      document,
      archiveObservation({ updatedAt: "2026-01-04T00:00:00.000Z" }),
    );
    expect(isObservationDocument(document)).toBe(true);
    expect(document.state.global.status).toBe("ARCHIVED");

    expect(document.operations.global).toHaveLength(4);
    for (const operation of document.operations.global) {
      expect(operation.error).toBeUndefined();
    }
  });

  it("should default content and observedBy to null when omitted", () => {
    const document = utils.createDocument();

    const updatedDocument = reducer(
      document,
      createObservation({
        title: "Minimal observation",
        description: "Created without optional fields",
        category: "PROCESS",
        observedAt: "2026-01-05T00:00:00.000Z",
      }),
    );

    expect(updatedDocument.state.global.content).toBeNull();
    expect(updatedDocument.state.global.observedBy).toBeNull();
    expect(updatedDocument.state.global.status).toBe("PENDING");
    expect(updatedDocument.operations.global[0].error).toBeUndefined();
  });
});
