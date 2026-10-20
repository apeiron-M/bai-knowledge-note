import { describe, expect, it } from "vitest";
import { safeUrl } from "./sanitize-url.js";

describe("safeUrl", () => {
  it("allows the schemes a note legitimately links with", () => {
    expect(safeUrl("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
    expect(safeUrl("http://example.com")).toBe("http://example.com");
    expect(safeUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  it("allows relative and fragment links", () => {
    expect(safeUrl("/notes/abc")).toBe("/notes/abc");
    expect(safeUrl("./sibling")).toBe("./sibling");
    expect(safeUrl("#heading")).toBe("#heading");
    expect(safeUrl("/a:b")).toBe("/a:b");
    expect(safeUrl("?q=a:b")).toBe("?q=a:b");
  });

  it("rejects executable schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
  });

  it("rejects schemes obfuscated by case, whitespace and control characters", () => {
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeUrl("  javascript:alert(1)")).toBeNull();
    expect(safeUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeUrl("java script:alert(1)")).toBeNull();
    // A leading NUL or DEL is stripped by browsers before scheme parsing.
    expect(safeUrl(String.fromCharCode(0) + "javascript:alert(1)")).toBeNull();
    expect(
      safeUrl("javascript" + String.fromCharCode(127) + ":alert(1)"),
    ).toBeNull();
  });

  it("rejects empty input", () => {
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
  });
});
