import {
  archiveObservation,
  createObservation,
  implementObservation,
  promoteObservation,
  reducer,
  utils,
} from "document-models/observation/v1";
import { describe, expect, it } from "vitest";

const T = "2026-01-01T00:00:00.000Z";
const created = () =>
  reducer(
    utils.createDocument(),
    createObservation({
      title: "t",
      description: "d",
      category: "FRICTION",
      observedAt: T,
    }),
  );

// PENDING → PROMOTED → IMPLEMENTED, or → ARCHIVED from any non-archived state.
// These reducers had no guards: IMPLEMENT from PENDING and a second ARCHIVE
// both used to succeed silently.
describe("observation transition guards", () => {
  it("does not implement an observation that was never promoted", () => {
    const document = reducer(created(), implementObservation({ updatedAt: T }));
    expect(document.operations.global[1].error).toBe(
      "Only a PROMOTED observation can be implemented (status is PENDING)",
    );
    expect(document.state.global.status).toBe("PENDING");
  });

  it("does not promote twice", () => {
    let document = reducer(
      created(),
      promoteObservation({ promotedTo: "note-1", promotedAt: T }),
    );
    document = reducer(
      document,
      promoteObservation({ promotedTo: "note-2", promotedAt: T }),
    );
    expect(document.operations.global[2].error).toBe(
      "Only a PENDING observation can be promoted (status is PROMOTED)",
    );
    expect(document.state.global.promotedTo).toBe("note-1");
  });

  it("archives from PENDING, PROMOTED or IMPLEMENTED, but not twice", () => {
    let document = reducer(created(), archiveObservation({ updatedAt: T }));
    expect(document.operations.global[1].error).toBeUndefined();
    expect(document.state.global.status).toBe("ARCHIVED");

    document = reducer(document, archiveObservation({ updatedAt: T }));
    expect(document.operations.global[2].error).toBe(
      "Observation is already archived",
    );
  });

  it("walks the full lifecycle without an error", () => {
    let document = reducer(
      created(),
      promoteObservation({ promotedTo: "note-1", promotedAt: T }),
    );
    document = reducer(document, implementObservation({ updatedAt: T }));
    document = reducer(document, archiveObservation({ updatedAt: T }));
    expect(document.state.global.status).toBe("ARCHIVED");
    for (const op of document.operations.global) expect(op.error).toBeUndefined();
  });
});
