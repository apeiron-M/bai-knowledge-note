import { describe, expect, it } from "vitest";
import { lifecycleKey } from "./lifecycle-key.js";

describe("lifecycleKey", () => {
  it("gives two events the same key when they are genuinely identical", () => {
    const event = {
      id: "e1",
      fromStatus: "DRAFT",
      toStatus: "IN_REVIEW",
      timestamp: "2026-09-17T12:35:06.000Z",
    };
    expect(lifecycleKey(event, 0)).toBe(lifecycleKey(event, 0));
  });

  it("distinguishes two events that share an id — the live-vault case", () => {
    // Written by an agent with the DOCUMENT id as the event id, twice:
    // `DRAFT -> IN_REVIEW` then `IN_REVIEW -> CANONICAL`. Keying by `id` alone
    // is what produced React's duplicate-key warning.
    const documentId = "28d9c1c5-8644-4ecb-a502-369851301397";
    const first = {
      id: documentId,
      fromStatus: "DRAFT",
      toStatus: "IN_REVIEW",
      timestamp: "2026-09-17T12:35:06.000Z",
    };
    const second = {
      id: documentId,
      fromStatus: "IN_REVIEW",
      toStatus: "CANONICAL",
      timestamp: "2026-09-17T12:35:06.000Z",
    };
    expect(lifecycleKey(first, 0)).not.toBe(lifecycleKey(second, 1));
  });

  it("stays unique when two events are identical in every field", () => {
    // A double-dispatch would look exactly like this, and only position can
    // tell the two rows apart.
    const event = { id: "", fromStatus: null, toStatus: null, timestamp: null };
    expect(lifecycleKey(event, 0)).not.toBe(lifecycleKey(event, 1));
  });

  it("copes with an event that has no id at all", () => {
    expect(lifecycleKey({ fromStatus: "DRAFT", toStatus: "ARCHIVED" }, 3)).toContain(
      "3",
    );
  });
});
