import { createAction, Property } from "@powerhousedao/pieces-framework";
import { ingestSource, SOURCE_TYPES, type SourceType } from "../agent/ingest.js";
import { knowledgeVaultAuth } from "../auth.js";
import { clientForContext, type StoreLike } from "../common/context.js";
import { driveProp } from "../common/props.js";

const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** One source into the vault, queued for the pipeline, never twice for one dedupe key. */
export const ingestSourceAction = createAction({
  auth: knowledgeVaultAuth,
  name: "ingest-source",
  displayName: "Ingest source",
  description:
    "Creates one source in the vault's /sources (optionally in a subfolder) and queues it for extraction, so a pipeline workflow picks it up. Give a dedupe key (a document id) and a repeated delivery is skipped instead of creating a second source.",
  audience: "both",
  props: {
    drive: driveProp,
    title: Property.ShortText({ displayName: "Title", required: true, description: "e.g. {{trigger.payload.body.title}}" }),
    content: Property.LongText({ displayName: "Content", required: true, description: "The text to store, e.g. {{trigger.payload.body.content}}" }),
    source_type: Property.StaticDropdown({
      displayName: "Source type",
      required: true,
      defaultValue: "CONVERSATION",
      options: { disabled: false, options: SOURCE_TYPES.map((t) => ({ label: t.toLowerCase().replace("_", " "), value: t })) },
    }),
    url: Property.ShortText({ displayName: "URL", required: false, description: "Where the original lives, e.g. the Google Doc link" }),
    author: Property.ShortText({ displayName: "Author", required: false }),
    published_at: Property.ShortText({ displayName: "Published at", required: false, description: "Any date the source carries; stored as a UTC instant, dropped if it cannot be read" }),
    description: Property.ShortText({ displayName: "Description", required: false }),
    folder: Property.ShortText({ displayName: "Folder", required: false, description: "A subfolder of /sources, created once, e.g. Meeting notes" }),
    dedupe_key: Property.ShortText({ displayName: "Dedupe key", required: false, description: "Skips a delivery already ingested, e.g. {{trigger.payload.body.id}}" }),
    queue: Property.Checkbox({ displayName: "Queue for extraction", required: false, defaultValue: true }),
    tool: Property.ShortText({ displayName: "Tool", required: false, description: "Recorded as the source's tool, e.g. google-apps-script" }),
  },
  outputSchema: {
    fields: [
      { key: "summary", label: "What happened" },
      { key: "source_id", label: "Source id" },
      { key: "skipped", label: "Skipped as a repeat" },
      { key: "queued", label: "Queued for extraction" },
    ],
  },
  async run(context) {
    const p = context.propsValue as Record<string, unknown>;
    const type = text(p.source_type);
    return ingestSource(clientForContext(context), context.store as unknown as StoreLike, {
      drive: text(p.drive),
      title: text(p.title),
      content: text(p.content),
      sourceType: ((SOURCE_TYPES as readonly string[]).includes(type) ? type : "CONVERSATION") as SourceType,
      description: text(p.description),
      author: text(p.author),
      url: text(p.url),
      publishedAt: text(p.published_at),
      folder: text(p.folder),
      dedupeKey: text(p.dedupe_key),
      queue: p.queue !== false,
      tool: text(p.tool),
    });
  },
});
