import { beforeEach, describe, expect, it } from "vitest";
import { stampActions } from "./envelope.js";

const now = () => new Date("2026-09-13T12:00:00.000Z");
let n = 0;
const uuid = () => `uuid-${++n}`;

beforeEach(() => {
  n = 0;
});

describe("stampActions", () => {
  it("fills id, timestampUtcMs and scope when absent", () => {
    const [out] = stampActions(
      [{ type: "SET_TITLE", input: { title: "x" } }],
      now,
      uuid,
      "global",
    );
    expect(out.id).toBe("uuid-1");
    expect(out.timestampUtcMs).toBe("2026-09-13T12:00:00.000Z");
    expect(out.scope).toBe("global");
  });

  it("preserves values the caller supplied", () => {
    const [out] = stampActions(
      [
        {
          id: "agent-id",
          timestampUtcMs: "2026-01-01T00:00:00.000Z",
          scope: "document",
          type: "ADD_RELATIONSHIP",
          input: {},
        },
      ],
      now,
      uuid,
      "global",
    );
    expect(out.id).toBe("agent-id");
    expect(out.timestampUtcMs).toBe("2026-01-01T00:00:00.000Z");
    expect(out.scope).toBe("document");
  });

  it("preserves an input object byte-for-byte, including key order", () => {
    const input = { zebra: 1, alpha: { two: 2, one: 1 } };
    const [out] = stampActions([{ type: "X", input }], now, uuid, "global");
    expect(JSON.stringify(out.input)).toBe(
      '{"zebra":1,"alpha":{"two":2,"one":1}}',
    );
    expect(out.input).toBe(input);
  });

  it("does not mutate the caller's array or objects", () => {
    const action = { type: "X", input: {} };
    const actions = [action];
    const out = stampActions(actions, now, uuid, "global");
    expect(out).not.toBe(actions);
    expect(out[0]).not.toBe(action);
    expect(action).toEqual({ type: "X", input: {} });
  });

  it("treats an empty string id as absent", () => {
    const [out] = stampActions(
      [{ id: "", timestampUtcMs: "", scope: "", type: "X", input: {} }],
      now,
      uuid,
      "global",
    );
    expect(out.id).toBe("uuid-1");
    expect(out.timestampUtcMs).toBe("2026-09-13T12:00:00.000Z");
    expect(out.scope).toBe("global");
  });
});
