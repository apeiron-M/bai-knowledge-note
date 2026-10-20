import { describe, expect, it } from "vitest";
import { generateId } from "document-model";
import * as KN from "document-models/knowledge-note";
import { buildVaultCatalog } from "../../editors/knowledge-vault/chat/core/catalog-models.js";
import { buildAction } from "../../editors/knowledge-vault/chat/core/envelope.js";
import {
  buildModelSchema,
  leafFields,
  semanticFieldNames,
  type CatalogEntry,
} from "../../editors/knowledge-vault/chat/core/op-catalog.js";
import { OP_DESCRIPTIONS } from "../../editors/knowledge-vault/chat/core/op-descriptions.js";

const catalog = buildVaultCatalog();
const byKey = new Map(catalog.map((e) => [e.key, e]));

function get(key: string): CatalogEntry {
  const e = byKey.get(key);
  if (!e) throw new Error(`missing ${key}`);
  return e;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A minimal value that satisfies a (model-facing) JSON Schema. */
function dummy(schema: unknown): unknown {
  if (!isRecord(schema)) return "x";
  if (Array.isArray(schema.enum)) return schema.enum[0] as unknown;
  if (Array.isArray(schema.anyOf)) return dummy(schema.anyOf[0]);
  switch (schema.type) {
    case "object": {
      const props = isRecord(schema.properties) ? schema.properties : {};
      return Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, dummy(v)]),
      );
    }
    case "array":
      return [dummy(schema.items)];
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    default:
      if (schema.format === "date-time") return "2026-10-20T00:00:00.000Z";
      if (schema.format === "uri") return "https://example.com";
      return "x";
  }
}

function dummyRefIds(entry: CatalogEntry): Record<string, string | string[]> {
  return Object.fromEntries(
    leafFields(entry.fields)
      .filter((f) => f.fieldClass === "ref-id")
      .map((f) => [f.path.join("."), f.list ? ["ref-1"] : "ref-1"]),
  );
}

const ctx = {
  generateId,
  now: () => "2026-10-20T12:00:00.000Z",
  actor: "chat-user",
};

describe("op catalog", () => {
  it("has 100 entries with unique keys", () => {
    expect(catalog).toHaveLength(100);
    expect(new Set(catalog.map((e) => e.key)).size).toBe(100);
  });

  it("exposes only `name` to the model for knowledge-note:ADD_TOPIC", () => {
    const entry = get("knowledge-note:ADD_TOPIC");
    expect(entry.modelSchema).toEqual({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
    const classes = Object.fromEntries(
      entry.fields.map((f) => [f.name, f.fieldClass]),
    );
    expect(classes).toEqual({
      id: "new-id",
      name: "semantic",
      topicDocumentId: "ref-id",
    });
  });

  it("turns a ref-id into an enum only when candidates are supplied", () => {
    const entry = get("knowledge-note:ADD_TOPIC");
    const withRefs = buildModelSchema(entry, {
      refCandidates: { topicDocumentId: ["doc-a", "doc-b"] },
    });
    expect(withRefs.properties).toEqual({
      name: { type: "string" },
      topicDocumentId: { type: "string", enum: ["doc-a", "doc-b"] },
    });
  });

  it("never exposes app-supplied fields to the model", () => {
    for (const e of catalog) {
      expect(e.modelSchema).not.toHaveProperty("$schema");
      for (const f of leafFields(e.fields)) {
        if (f.fieldClass === "semantic") continue;
        let node: unknown = e.modelSchema;
        for (const seg of f.path) {
          const props: unknown = isRecord(node) ? node.properties : undefined;
          node = isRecord(props) ? props[seg] : undefined;
        }
        expect(node, `${e.key}:${f.path.join(".")}`).toBeUndefined();
      }
    }
  });

  it("classifies nested handoff fields by path (pipeline-queue:ADVANCE_PHASE)", () => {
    const entry = get("pipeline-queue:ADVANCE_PHASE");
    const classes = Object.fromEntries(
      leafFields(entry.fields).map((f) => [f.path.join("."), f.fieldClass]),
    );
    expect(classes).toMatchObject({
      taskId: "ref-id",
      updatedAt: "timestamp",
      "handoff.id": "new-id",
      "handoff.completedAt": "timestamp",
      "handoff.completedBy": "actor",
      "handoff.phase": "semantic",
    });
  });

  it("round-trips every op that has app-supplied id/timestamp/actor fields", () => {
    const appFilled = catalog.filter((e) =>
      leafFields(e.fields).some((f) =>
        ["new-id", "timestamp", "actor"].includes(f.fieldClass),
      ),
    );
    expect(appFilled.length).toBeGreaterThan(50);
    const failures: string[] = [];
    for (const entry of appFilled) {
      const args = dummy(entry.modelSchema);
      const result = buildAction(entry, isRecord(args) ? args : {}, {
        ...ctx,
        refIds: dummyRefIds(entry),
      });
      if (!result.ok) failures.push(`${entry.key}: ${result.error}`);
      else {
        expect(result.action.type).toBe(entry.opName);
        expect(result.action.scope).toBe(entry.scope);
      }
    }
    expect(failures).toEqual([]);
  });

  it("reduces ADD_TOPIC and SET_TITLE against an empty note without error", () => {
    const topic = buildAction(
      get("knowledge-note:ADD_TOPIC"),
      { name: "distributed systems" },
      ctx,
    );
    const title = buildAction(
      get("knowledge-note:SET_TITLE"),
      { title: "CAP theorem" },
      ctx,
    );
    if (!topic.ok || !title.ok) throw new Error("buildAction failed");
    let doc = KN.utils.createDocument();
    doc = KN.reducer(doc, topic.action);
    doc = KN.reducer(doc, title.action);
    expect(doc.operations.global[0].error).toBeUndefined();
    expect(doc.operations.global[1].error).toBeUndefined();
    expect(doc.state.global.topics[0].name).toBe("distributed systems");
    expect(doc.state.global.title).toBe("CAP theorem");
  });

  it("returns a zod error instead of throwing on bad semantic args", () => {
    const result = buildAction(
      get("knowledge-note:ADD_TOPIC"),
      { name: 42 },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it("classifies OID fields of ops with no semantic fields as ref-id", () => {
    const empty = catalog.filter((e) => semanticFieldNames(e).length === 0);
    const keys = empty.map((e) => e.key).sort();
    // The plan estimated 15; the classification rules yield 22 (it also
    // counts timestamp-only and PHID-only ops).
    expect(keys).toEqual([
      "knowledge-note:REMOVE_LINK",
      "knowledge-note:REMOVE_TOPIC",
      "knowledge-note:SET_LAST_VIEWED",
      "moc:REMOVE_CORE_IDEA",
      "moc:REMOVE_TENSION",
      "moc:REORDER_CORE_IDEAS",
      "observation:ARCHIVE_OBSERVATION",
      "observation:IMPLEMENT_OBSERVATION",
      "pipeline-queue:COMPLETE_TASK",
      "pipeline-queue:UNBLOCK_TASK",
      "project:ADD_KNOWLEDGE_REF",
      "project:LINK_WBS",
      "project:REMOVE_DELIVERABLE",
      "project:REMOVE_KNOWLEDGE_REF",
      "project:REMOVE_MEMBER",
      "research-claim:REMOVE_RESEARCH_CONNECTION",
      "wbs:ADD_DEPENDENCIES",
      "wbs:DELETE_GOAL",
      "wbs:REMOVE_DEPENDENCIES",
      "wbs:REMOVE_NOTE",
      "wbs:REORDER",
      "wbs:SET_PROJECT_REF",
    ]);
    for (const e of empty) {
      for (const f of leafFields(e.fields)) {
        if (f.gqlType === "OID") expect(f.fieldClass, e.key).toBe("ref-id");
      }
    }
  });

  it("has a description override for every op and no stray keys", () => {
    const overridden = buildVaultCatalog({
      descriptionOverrides: OP_DESCRIPTIONS,
    });
    const keys = new Set(overridden.map((e) => e.key));
    expect(Object.keys(OP_DESCRIPTIONS).filter((k) => !keys.has(k))).toEqual(
      [],
    );
    for (const e of overridden) {
      expect(e.description, e.key).toBe(OP_DESCRIPTIONS[e.key]);
    }
  });

  it("keeps the models' own descriptions by default", () => {
    expect(get("knowledge-note:ADD_TOPIC").description).toBe(
      "Tag the note with a topic",
    );
  });
});
