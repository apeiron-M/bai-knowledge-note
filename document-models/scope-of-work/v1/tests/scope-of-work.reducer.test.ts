import { editScopeOfWork, utils } from "document-models/scope-of-work/v1";
import { describe, expect, it } from "vitest";
import { apply, errors, state } from "./reducer-test-helpers.js";

describe("scope-of-work reducer", () => {
  it("edits title, description and status together", () => {
    const doc = apply(
      utils.createDocument(),
      editScopeOfWork({
        title: "SoW",
        description: "Desc",
        status: "IN_PROGRESS",
      }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc)).toMatchObject({
      title: "SoW",
      description: "Desc",
      status: "IN_PROGRESS",
    });
  });

  it("preserves every field that is omitted or explicitly null", () => {
    const doc = apply(
      utils.createDocument(),
      editScopeOfWork({
        title: "SoW",
        description: "Desc",
        status: "APPROVED",
      }),
      editScopeOfWork({}),
      editScopeOfWork({ title: null, description: null, status: null }),
    );

    expect(errors(doc)).toStrictEqual([]);
    expect(state(doc)).toMatchObject({
      title: "SoW",
      description: "Desc",
      status: "APPROVED",
    });
  });
});
