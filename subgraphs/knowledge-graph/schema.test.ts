import { describe, expect, it } from "vitest";
import { buildASTSchema, concatAST, parse } from "graphql";
import { schema } from "./schema.js";

/** The subgraph's SDL only extends Query and Mutation; the gateway supplies the roots. */
function build() {
  return buildASTSchema(concatAST([parse("type Query { _: Boolean } type Mutation { _: Boolean }"), schema]));
}

describe("knowledgeGraph schema", () => {
  it("builds, and serves the source timeline for a drive", () => {
    const built = build();
    const field = built.getQueryType()?.getFields().knowledgeGraphSourceTimeline;
    expect(String(field?.type)).toBe("KnowledgeGraphSourceTimeline!");
    expect(field?.args.map((a) => `${a.name}: ${String(a.type)}`)).toEqual(["driveId: ID!"]);
  });

  it("gives every node the time it entered the vault", () => {
    const node = build().getType("KnowledgeGraphNode") as { getFields(): Record<string, { type: unknown }> };
    expect(String(node.getFields().addedAt.type)).toBe("String");
    const topic = build().getType("KnowledgeGraphTimelineTopic") as { getFields(): Record<string, { type: unknown }> };
    expect(Object.keys(topic.getFields())).toEqual(["documentId", "title", "addedAt", "writtenAt", "additionId"]);
  });

  it("offers the source-history backfill as a mutation", () => {
    const field = build().getMutationType()?.getFields().knowledgeGraphBackfillSourceHistory;
    expect(String(field?.type)).toBe("SourceHistoryBackfill!");
    expect(field?.args.map((a) => `${a.name}: ${String(a.type)}`)).toEqual(["driveId: ID!"]);
    const result = build().getType("SourceHistoryBackfill") as { getFields(): Record<string, unknown> };
    expect(Object.keys(result.getFields())).toEqual(["sources", "inserted", "skipped", "errors"]);
  });
});
