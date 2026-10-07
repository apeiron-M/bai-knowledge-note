import { describe, expect, it } from "vitest";
import { deriveIds, templatize } from "../../scripts/lib/workflow-template.mjs";

const ORIGIN = "https://switchboard.knowledge-vault.vetra.io";
const DRIVE = "c5893e1b-854b-49b1-b8aa-6b133ab87969";
const CONN = "w7URVnjZgl-msYAd3DgQxJDf8dpCy_Iah3XlwoJGZrQ";
const connection = [
  { type: "CREATE_DOCUMENT", input: {} },
  { type: "SET_CONNECTION_NAME", input: { name: "Knowledge Vault" } },
  { type: "UPGRADE_DOCUMENT", input: { fromVersion: 0, toVersion: 1 } },
  { type: "SET_CONNECTOR", input: { authType: "CUSTOM_AUTH", connectorId: "@powerhousedao/piece-knowledge-vault#knowledge-vault" } },
  { type: "SET_CONFIG", input: { config: { base_url: ORIGIN, llm_default_model: "openai/gpt-6-luna" } } },
  { type: "SET_SECRET_REF", input: { id: "bccb", ref: "secret://v1:3eb2", name: "token" } },
  { type: "SET_SECRET_REF", input: { id: "6491", ref: "secret://v1:6e41", name: "llm_api_key" } },
  { type: "RECORD_CHECK_RESULT", input: { ok: true, checkedAt: "2026-10-02T00:00:00.000Z" } },
  { type: "SET_ACCOUNT_LABEL", input: { accountLabel: "0xadbA…BcA4 @ switchboard.knowledge-vault.vetra.io · 1 vault" } },
];
const workflow = [
  { type: "CREATE_DOCUMENT", input: {} },
  { type: "SET_WORKFLOW_NAME", input: { name: "Vault pipeline (auto)" } },
  { type: "UPGRADE_DOCUMENT", input: { fromVersion: 0, toVersion: 1 } },
  { type: "SET_WORKFLOW_DESCRIPTION", input: { description: "Every source queued runs extract → connect → place → verify." } },
  { type: "SET_TRIGGER", input: { id: "trig", config: { drive: DRIVE, phase: "create", per_poll: 1, include_backlog: false }, pieceName: "@powerhousedao/piece-knowledge-vault", triggerName: "new-pipeline-task", connectionId: CONN, pieceVersion: "1.0.54-dev.19" } },
  { type: "ADD_STEP", input: { id: "s1", key: "extract", name: "Extract claims", config: { mode: "write", drive: DRIVE, model: "openai/gpt-6-luna", source_id: "{{trigger.payload.source_id}}" }, pieceName: "@powerhousedao/piece-knowledge-vault", actionName: "extract-claims", connectionId: CONN, pieceVersion: "1.0.54-dev.19", timeoutSeconds: 300 } },
  { type: "ADD_EDGE", input: { id: "e1", from: "trig", to: "s1", port: "next" } },
  { type: "PUBLISH_WORKFLOW", input: { publishedAt: "2026-09-29T14:02:34.657Z" } },
  { type: "SET_WORKFLOW_STATUS", input: { status: "ENABLED" } },
  { type: "SET_WORKFLOW_STATUS", input: { status: "DISABLED" } },
  { type: "SET_LAST_TEST", input: { runId: "r1", testedAt: "2026-10-02T12:41:49.234Z" } },
  { type: "SET_TRIGGER", input: { id: "trig", config: { drive: DRIVE, phase: "create", per_poll: 1, include_backlog: true }, pieceName: "@powerhousedao/piece-knowledge-vault", triggerName: "new-pipeline-task", connectionId: CONN, pieceVersion: "1.0.54-dev.19" }, error: null },
  { type: "PUBLISH_WORKFLOW", input: { publishedAt: "2026-10-02T12:43:22.812Z" } },
  { type: "SET_WORKFLOW_STATUS", input: { status: "ENABLED" } },
  { type: "SET_WORKFLOW_STATUS", input: { status: "ENABLED" }, error: "rejected" },
];

describe("deriveIds", () => {
  it("reads every concrete value from the documents themselves", () => {
    expect(deriveIds({ workflow, connection })).toEqual({
      driveId: DRIVE,
      connectionId: CONN,
      switchboardOrigin: ORIGIN,
      secretRefs: { token: "secret://v1:3eb2", llm_api_key: "secret://v1:6e41" },
      model: "openai/gpt-6-luna",
      pieceVersion: "1.0.54-dev.19",
    });
  });
});

describe("templatize", () => {
  const t = templatize({ workflow, connection });
  const text = JSON.stringify(t);
  it("leaves no concrete id, origin, secret, model, version, name or timestamp behind", () => {
    for (const concrete of [DRIVE, CONN, ORIGIN, "secret://v1:3eb2", "secret://v1:6e41", "gpt-6-luna", "1.0.54-dev.19", "Vault pipeline (auto)", "Knowledge Vault\"", "2026-09-29", "2026-10-02", "0xadbA"]) {
      expect(text, concrete).not.toContain(concrete);
    }
    // the template's own expressions ({{trigger.payload…}}) are the runtime's, not ours, and survive
    expect(text).toContain("{{trigger.payload.source_id}}");
  });
  it("keeps what builds the documents, in order, and drops history", () => {
    expect(t.connection.operations.map((o) => o.type)).toEqual(["SET_CONNECTION_NAME", "SET_CONNECTOR", "SET_CONFIG", "SET_SECRET_REF", "SET_SECRET_REF"]);
    expect(t.workflow.operations.map((o) => o.type)).toEqual(["SET_WORKFLOW_NAME", "SET_WORKFLOW_DESCRIPTION", "SET_TRIGGER", "ADD_STEP", "ADD_EDGE", "PUBLISH_WORKFLOW", "SET_TRIGGER", "PUBLISH_WORKFLOW", "SET_WORKFLOW_STATUS"]);
    expect(t.workflow.operations.at(-1)!.input).toEqual({ status: "ENABLED" }); // the final status once, at the end; the rejected duplicate is gone
  });
  it("substitutes placeholders where the concrete values were, and adds the LLM provider URL", () => {
    expect(t.connection.operations[0].input).toEqual({ name: "{{CONNECTION_NAME}}" });
    expect(t.connection.operations[2].input).toEqual({ config: { base_url: "{{SWITCHBOARD_ORIGIN}}", llm_default_model: "{{LLM_MODEL}}", llm_base_url: "{{LLM_BASE_URL}}" } });
    expect(t.connection.operations[3].input).toEqual({ id: "bccb", ref: "{{TOKEN_SECRET_REF}}", name: "token" });
    expect(t.connection.operations[4].input).toEqual({ id: "6491", ref: "{{LLM_SECRET_REF}}", name: "llm_api_key" });
    expect(t.workflow.operations[0].input).toEqual({ name: "{{WORKFLOW_NAME}}" });
    const trigger = t.workflow.operations[2].input as { config: { drive: string }; connectionId: string; pieceVersion: string };
    expect(trigger.config.drive).toBe("{{DRIVE_ID}}");
    expect(trigger.connectionId).toBe("{{CONNECTION_ID}}");
    expect(trigger.pieceVersion).toBe("{{PIECE_VERSION}}");
    const step = t.workflow.operations[3].input as { config: { model: string; drive: string }; connectionId: string };
    expect(step.config).toMatchObject({ model: "{{LLM_MODEL}}", drive: "{{DRIVE_ID}}" });
    expect(t.workflow.operations[5].input).toEqual({ publishedAt: "{{NOW}}" });
    expect(t.placeholders).toEqual(["{{CONNECTION_ID}}", "{{CONNECTION_NAME}}", "{{DRIVE_ID}}", "{{LLM_BASE_URL}}", "{{LLM_MODEL}}", "{{LLM_SECRET_REF}}", "{{NOW}}", "{{PIECE_VERSION}}", "{{SWITCHBOARD_ORIGIN}}", "{{TOKEN_SECRET_REF}}", "{{WORKFLOW_NAME}}"]);
    expect(t.version).toBe(1);
    expect(t.connection.documentType).toBe("powerhouse/connection");
    expect(t.workflow.documentType).toBe("powerhouse/workflow");
  });
});
