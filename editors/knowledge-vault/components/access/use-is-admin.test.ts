import { describe, expect, it, vi } from "vitest";
import { createAdminCheck } from "./use-is-admin.js";

function probes(opts: {
  canManage?: boolean;
  fieldAvailable?: boolean;
  documentAccessAnswers?: boolean;
}) {
  const canManage = vi.fn(() =>
    Promise.resolve(
      opts.fieldAvailable === false
        ? { error: 'Cannot query field "canManage" on type "Query".' }
        : { data: { canManage: opts.canManage ?? false } },
    ),
  );
  const documentAccess = vi.fn(() =>
    Promise.resolve(opts.documentAccessAnswers ? { data: { ok: true } } : {}),
  );
  return { canManage, documentAccess };
}

describe("createAdminCheck", () => {
  it("answers from the boolean probe and never touches the refusing one", async () => {
    const p = probes({ canManage: true });
    await expect(createAdminCheck(p).check("d1")).resolves.toBe(true);
    expect(p.documentAccess).not.toHaveBeenCalled();
  });

  it("a non-admin is decided WITHOUT calling documentAccess — the whole point", async () => {
    const p = probes({ canManage: false });
    await expect(createAdminCheck(p).check("d1")).resolves.toBe(false);
    // This call is what wrote an error into the Switchboard log per session.
    expect(p.documentAccess).not.toHaveBeenCalled();
  });

  it("falls back to the refusing probe when the field is not deployed", async () => {
    const admin = probes({ fieldAvailable: false, documentAccessAnswers: true });
    await expect(createAdminCheck(admin).check("d1")).resolves.toBe(true);
    expect(admin.documentAccess).toHaveBeenCalledTimes(1);

    const reader = probes({ fieldAvailable: false, documentAccessAnswers: false });
    await expect(createAdminCheck(reader).check("d1")).resolves.toBe(false);
  });

  it("caches the verdict per drive", async () => {
    const p = probes({ canManage: true });
    const check = createAdminCheck(p);
    await check.check("d1");
    await check.check("d1");
    expect(p.canManage).toHaveBeenCalledTimes(1);
    expect(check.peek("d1")).toBe(true);
    expect(check.peek("other")).toBeUndefined();
  });

  it("shares one in-flight probe between concurrent askers", async () => {
    const p = probes({ canManage: true });
    const check = createAdminCheck(p);
    await Promise.all([check.check("d1"), check.check("d1"), check.check("d1")]);
    expect(p.canManage).toHaveBeenCalledTimes(1);
  });

  it("re-asks after invalidate", async () => {
    const p = probes({ canManage: true });
    const check = createAdminCheck(p);
    await check.check("d1");
    check.invalidate("d1");
    expect(check.peek("d1")).toBeUndefined();
    await check.check("d1");
    expect(p.canManage).toHaveBeenCalledTimes(2);
  });
});
