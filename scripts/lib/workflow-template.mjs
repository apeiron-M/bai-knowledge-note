// A workflow and its connection as a replayable, model-agnostic template:
// the documents' own operations with every concrete value replaced by a
// placeholder. The desktop app instantiates it per vault (spec §4.5, §7.5).
// Model-agnostic because nothing here knows the operations' shapes beyond
// the few whose values are environment-specific; a new field in the models
// rides along untouched.

const HISTORY = new Set([
  "CREATE_DOCUMENT", // the instantiator creates the document itself
  "UPGRADE_DOCUMENT", // likewise: a fresh document starts at the installed version
  "SET_LAST_TEST", // test history
  "RECORD_CHECK_RESULT", // the runtime's own check results
  "SET_ACCOUNT_LABEL", // derived by the runtime from a check
]);

/** Every concrete value the template must not carry, read from the documents themselves. */
export function deriveIds(docs) {
  const by = (ops, type) => ops.filter((o) => o.type === type && !o.error).map((o) => o.input);
  const triggers = by(docs.workflow, "SET_TRIGGER");
  const trigger = triggers.at(-1) ?? {};
  const config = by(docs.connection, "SET_CONFIG").at(-1)?.config ?? {};
  const secretRefs = {};
  for (const ref of by(docs.connection, "SET_SECRET_REF")) if (ref?.name && ref?.ref) secretRefs[ref.name] = ref.ref;
  return {
    driveId: trigger.config?.drive ?? by(docs.workflow, "ADD_STEP").at(0)?.config?.drive,
    connectionId: trigger.connectionId ?? by(docs.workflow, "ADD_STEP").at(0)?.connectionId,
    switchboardOrigin: config.base_url,
    secretRefs,
    model: config.llm_default_model ?? by(docs.workflow, "ADD_STEP").at(0)?.config?.model,
    pieceVersion: trigger.pieceVersion ?? by(docs.workflow, "ADD_STEP").at(0)?.pieceVersion,
  };
}

function substitute(value, pairs) {
  let text = JSON.stringify(value);
  for (const [concrete, placeholder] of pairs) text = text.split(concrete).join(placeholder);
  return JSON.parse(text);
}

function clean(ops, pairs) {
  return ops.filter((o) => !o.error && !HISTORY.has(o.type)).map((o) => ({ type: o.type, input: substitute(o.input, pairs) }));
}

/**
 * @param docs { workflow: Op[], connection: Op[] } — `Op = { type, input, error? }`, in operation order
 * @param ids  defaults to deriveIds(docs); pass overrides when exporting from an unusual pair
 */
export function templatize(docs, ids = deriveIds(docs)) {
  const pairs = [
    [ids.switchboardOrigin, "{{SWITCHBOARD_ORIGIN}}"],
    [ids.driveId, "{{DRIVE_ID}}"],
    [ids.connectionId, "{{CONNECTION_ID}}"],
    [ids.secretRefs?.token, "{{TOKEN_SECRET_REF}}"],
    [ids.secretRefs?.llm_api_key, "{{LLM_SECRET_REF}}"],
    [ids.model, "{{LLM_MODEL}}"],
    [ids.pieceVersion, "{{PIECE_VERSION}}"],
  ]
    .filter(([concrete]) => typeof concrete === "string" && concrete.length > 0)
    // Longest first, so an origin containing a port is replaced before any shorter id could match inside it.
    .sort((a, b) => b[0].length - a[0].length);

  const connection = clean(docs.connection, pairs).map((o) => {
    if (o.type === "SET_CONNECTION_NAME") return { type: o.type, input: { ...o.input, name: "{{CONNECTION_NAME}}" } };
    if (o.type === "SET_CONFIG") return { type: o.type, input: { ...o.input, config: { ...o.input.config, llm_base_url: "{{LLM_BASE_URL}}" } } };
    return o;
  });

  let status;
  const workflow = clean(docs.workflow, pairs)
    .filter((o) => {
      if (o.type !== "SET_WORKFLOW_STATUS") return true;
      status = o.input; // the toggles collapse to the final one, placed after everything else
      return false;
    })
    .map((o) => {
      if (o.type === "SET_WORKFLOW_NAME") return { type: o.type, input: { ...o.input, name: "{{WORKFLOW_NAME}}" } };
      if (o.type === "PUBLISH_WORKFLOW") return { type: o.type, input: { ...o.input, publishedAt: "{{NOW}}" } };
      return o;
    });
  if (status) workflow.push({ type: "SET_WORKFLOW_STATUS", input: status });

  const template = {
    version: 1,
    exportedAt: new Date().toISOString(),
    placeholders: [],
    connection: { documentType: "powerhouse/connection", operations: connection },
    workflow: { documentType: "powerhouse/workflow", operations: workflow },
  };
  // Only our placeholders ({{UPPER_CASE}}); the runtime's own expressions ({{trigger.payload.x}}) are lower-case paths.
  template.placeholders = [...new Set(JSON.stringify(template).match(/\{\{[A-Z_]+\}\}/g) ?? [])].sort();
  return template;
}
