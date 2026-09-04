/**
 * The vault's read tools, offered to Connect's built-in AI assistant.
 *
 * Connect's chat (apps/connect/src/components/reactor-chat.tsx, Sept 2026)
 * merges every installed package's `aiTools` export into its agent's tool
 * set: descriptors with a zod input shape and a callback whose result is
 * read as an MCP envelope (`structuredContent` first, else the text part).
 * The ten read tools the vault's own chat runs are exposed here, so a user
 * of Connect's assistant can ask what the vault says about something and get
 * cited notes back without opening the vault app. Read-only by annotation,
 * so the assistant never pauses for approval on them.
 *
 * Typed structurally after `PhAiToolDescriptor` (@powerhousedao/shared) rather
 * than imported: the stack this package is built against predates the type,
 * an older Connect simply ignores the export, and a newer one type-checks the
 * shape when it reads `DocumentModelLib.aiTools`.
 *
 * A tool call from Connect's chat carries no drive: the callback defaults to
 * the drive the user has open (`window.ph.selectedDriveId`) and accepts an
 * explicit `driveId` for anything else.
 */
import { z, type ZodRawShape, type ZodType } from "zod";
import { executeTool as realExecuteTool, VAULT_TOOLS } from "./vault-tools.js";

/** MCP-compatible annotation hints, as `PhAiToolAnnotations` names them. */
export interface VaultAiToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Structural twin of `PhAiToolDescriptor`. */
export interface VaultAiTool {
  name: string;
  description?: string;
  inputSchema: ZodRawShape;
  annotations?: VaultAiToolAnnotations;
  callback: (args: never) => Promise<unknown>;
}

/** The MCP `CallToolResult` envelope Connect's adapter unwraps. */
export interface ToolEnvelope {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
}

/**
 * The subset of JSON Schema the vault's tool parameters use — flat objects
 * of strings, integers, numbers and booleans, some with enums — as a zod
 * raw shape, which is what `z.object(descriptor.inputSchema)` in Connect's
 * agent expects. Anything richer degrades to `z.unknown()` rather than
 * rejecting a call.
 */
export function zodShapeFromParameters(
  parameters: Record<string, unknown>,
): ZodRawShape {
  const props = (parameters.properties ?? {}) as Record<string, JsonSchemaProperty>;
  const required = new Set(
    Array.isArray(parameters.required)
      ? (parameters.required as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
  );
  // zod v4's ZodRawShape is read-only; build mutably and hand it over.
  const shape: Record<string, ZodType> = {};
  for (const [key, prop] of Object.entries(props)) {
    let t: ZodType;
    const enumValues = Array.isArray(prop.enum)
      ? prop.enum.filter((v): v is string => typeof v === "string")
      : [];
    if (enumValues.length > 0) {
      t = z.enum(enumValues as [string, ...string[]]);
    } else {
      switch (prop.type) {
        case "string":
          t = z.string();
          break;
        case "integer":
          t = z.number().int();
          break;
        case "number":
          t = z.number();
          break;
        case "boolean":
          t = z.boolean();
          break;
        default:
          t = z.unknown();
      }
    }
    if (prop.description) t = t.describe(prop.description);
    shape[key] = required.has(key) ? t : t.optional();
  }
  return shape;
}

const DRIVE_ID_DESCRIPTION =
  "The knowledge-vault drive to read (id or slug). Defaults to the drive currently open in Connect; pass it only to read another vault.";

/** The drive the user has open, as reactor-browser publishes it. */
export function selectedDriveId(): string | undefined {
  return (globalThis as { ph?: { selectedDriveId?: string } }).ph?.selectedDriveId;
}

export function envelope(result: { ok: true; data: unknown; summary: string } | { ok: false; error: string }): ToolEnvelope {
  return result.ok
    ? { content: [{ type: "text", text: result.summary }], structuredContent: result.data }
    : { isError: true, content: [{ type: "text", text: result.error }] };
}

/**
 * Build the descriptors. Dependencies are injectable so the mapping can be
 * tested without a reactor; the default export below wires the real ones.
 */
export function buildVaultAiTools(deps: {
  execute?: typeof realExecuteTool;
  defaultDriveId?: () => string | undefined;
} = {}): VaultAiTool[] {
  const execute = deps.execute ?? realExecuteTool;
  const defaultDriveId = deps.defaultDriveId ?? selectedDriveId;
  return VAULT_TOOLS.map((tool): VaultAiTool => {
    const { name, description, parameters } = tool.function;
    return {
      name,
      description: `Knowledge vault — ${description}`,
      inputSchema: {
        ...zodShapeFromParameters(parameters),
        driveId: z.string().optional().describe(DRIVE_ID_DESCRIPTION),
      },
      annotations: { title: name, readOnlyHint: true, openWorldHint: false },
      callback: async (raw: never) => {
        // `never` is the descriptor contract (any per-tool args type is
        // assignable); the agent passes the zod-validated object.
        const { driveId, ...args } = raw as unknown as Record<string, unknown> & {
          driveId?: string;
        };
        const drive = driveId ?? defaultDriveId();
        if (!drive) {
          return envelope({
            ok: false,
            error:
              "No vault drive is selected. Open a knowledge-vault drive in Connect, or pass driveId.",
          });
        }
        return envelope(await execute(name, args, { driveId: drive }));
      },
    };
  });
}

/** What Connect's assistant picks up from this package. */
export const aiTools: readonly VaultAiTool[] = buildVaultAiTools();
