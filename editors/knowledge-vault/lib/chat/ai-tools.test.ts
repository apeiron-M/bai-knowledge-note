import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { VAULT_TOOLS } from "./vault-tools.js";
import { buildVaultAiTools, envelope, zodShapeFromParameters } from "./ai-tools.js";

describe("zodShapeFromParameters", () => {
  const shape = zodShapeFromParameters({
    type: "object",
    properties: {
      query: { type: "string", description: "What to look for" },
      limit: { type: "integer" },
      includeArchived: { type: "boolean" },
      documentType: { type: "string", enum: ["bai/source", "bai/moc"] },
      weird: { type: "array" },
    },
    required: ["query"],
  });
  const schema = z.object(shape);

  it("requires what the JSON schema requires and makes the rest optional", () => {
    expect(schema.safeParse({ query: "x" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ query: "x", limit: 3, includeArchived: true, documentType: "bai/moc" }).success).toBe(true);
  });

  it("types integers, booleans and enums; unknown shapes are accepted rather than rejected", () => {
    expect(schema.safeParse({ query: "x", limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ query: "x", includeArchived: "yes" }).success).toBe(false);
    expect(schema.safeParse({ query: "x", documentType: "nope" }).success).toBe(false);
    expect(schema.safeParse({ query: "x", weird: [1, 2] }).success).toBe(true);
    expect((shape.query as z.ZodType).description).toBe("What to look for");
  });
});

describe("buildVaultAiTools", () => {
  it("offers every vault tool, read-only, with an optional driveId added to its schema", () => {
    const tools = buildVaultAiTools({ defaultDriveId: () => "d1" });
    expect(tools.map((t) => t.name)).toEqual(VAULT_TOOLS.map((t) => t.function.name));
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true });
      expect(t.description).toMatch(/^Knowledge vault — /);
      expect(z.object(t.inputSchema).safeParse({ driveId: "x" }).success || t.name !== "vault_stats").toBe(true);
      expect("driveId" in t.inputSchema).toBe(true);
    }
  });

  it("runs the vault tool against the selected drive and returns an MCP envelope with the data as structuredContent", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, data: [{ documentId: "n1" }], summary: 'searched "x" → 1 note' });
    const [search] = buildVaultAiTools({ execute, defaultDriveId: () => "drive-1" });
    const out = await search.callback({ query: "x", limit: 5 } as never);
    expect(execute).toHaveBeenCalledWith("search_vault", { query: "x", limit: 5 }, { driveId: "drive-1" });
    expect(out).toEqual({
      content: [{ type: "text", text: 'searched "x" → 1 note' }],
      structuredContent: [{ documentId: "n1" }],
    });
  });

  it("lets a call name another vault explicitly, and reports a tool failure as an error envelope", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: false, error: "no document with id zzz" });
    const readNote = buildVaultAiTools({ execute, defaultDriveId: () => "drive-1" }).find((t) => t.name === "read_note")!;
    const out = await readNote.callback({ documentId: "zzz", driveId: "other" } as never);
    expect(execute).toHaveBeenCalledWith("read_note", { documentId: "zzz" }, { driveId: "other" });
    expect(out).toEqual({ isError: true, content: [{ type: "text", text: "no document with id zzz" }] });
  });

  it("refuses, with a plain explanation, when no vault drive is open", async () => {
    const execute = vi.fn();
    const [tool] = buildVaultAiTools({ execute, defaultDriveId: () => undefined });
    const out = (await tool.callback({ query: "x" } as never)) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("No vault drive is selected");
    expect(execute).not.toHaveBeenCalled();
  });

  it("envelope() is the MCP shape Connect unwraps", () => {
    expect(envelope({ ok: true, data: { a: 1 }, summary: "s" })).toEqual({ content: [{ type: "text", text: "s" }], structuredContent: { a: 1 } });
    expect(envelope({ ok: false, error: "e" })).toEqual({ isError: true, content: [{ type: "text", text: "e" }] });
  });
});
