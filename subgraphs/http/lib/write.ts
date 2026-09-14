import type { PHDocument } from "document-model";
import type { Action } from "document-model";
import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "./authorize.js";
import type { HttpRouteDeps } from "./deps.js";
import { stampActions, type RawAction } from "./envelope.js";
import { lintActions } from "./lint/index.js";
import { HttpError } from "./respond.js";

export interface WriteResult {
  revision: unknown;
  operations: {
    index: number;
    type: string;
    error: string | null;
    attribution: "agent" | "server";
  }[];
  jobId?: string;
}

export interface WriteOptions {
  documentId: string;
  document: PHDocument;
  actions: RawAction[];
  ctx: RouteContext;
  wait: boolean;
  allowLiteralEscapes?: boolean;
  defaultScope?: string;
}

const LIFECYCLE_OPERATIONS = new Set([
  "SUBMIT_FOR_REVIEW",
  "APPROVE_NOTE",
  "REJECT_NOTE",
  "ARCHIVE_NOTE",
  "RESTORE_NOTE",
]);

const signerAddressOf = (action: RawAction): string | undefined =>
  (
    action.context as
      | { signer?: { user?: { address?: string } } }
      | undefined
  )?.signer?.user?.address;

export async function executeWrite(
  deps: HttpRouteDeps,
  options: WriteOptions,
): Promise<WriteResult> {
  const user = requireUser(options.ctx);
  const documentType = options.document.header.documentType;

  const findings = lintActions(documentType, options.document.state, options.actions, {
    allowLiteralEscapes: options.allowLiteralEscapes,
  });
  if (findings.length) {
    const code = findings.some((f) => f.class === "REACTOR_REJECTS")
      ? "LINT_REACTOR"
      : "LINT_CONVENTION";
    throw new HttpError(400, code, `${findings.length} lint findings`, findings);
  }

  const stamped = stampActions(
    options.actions,
    () => deps.now(),
    () => deps.uuid(),
    options.defaultScope ?? "global",
  );

  for (const [index, action] of stamped.entries()) {
    const signer = signerAddressOf(action);
    if (
      signer &&
      signer !== user.address &&
      !deps.authorization.isSupremeAdmin(user.address)
    ) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        `Action ${index} is signed by another identity`,
        [{ path: `actions[${index}]` }],
      );
    }
    if (
      LIFECYCLE_OPERATIONS.has(action.type) &&
      !deps.authorization.isSupremeAdmin(user.address) &&
      !(await deps.authorization.canMutate(
        options.documentId as CanonicalDocumentId,
        action.type,
        user.address,
      ))
    ) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        `No permission for ${action.type}`,
        [{ path: `actions[${index}]` }],
      );
    }
  }

  const revisions = Object.values(options.document.header.revision ?? {
    global: 0,
  });
  const prior = revisions.length ? Math.min(...revisions) : 0;
  // The host hands routes a signal that is already aborted once the body has
  // been consumed, which makes the reactor client's signer abort every write.
  // Use it only while it is live.
  const signal =
    options.ctx.signal && !options.ctx.signal.aborted
      ? options.ctx.signal
      : undefined;

  const job = await deps.reactorClient.executeAsync(
    options.documentId,
    "main",
    stamped as unknown as Action[],
    signal,
  );
  if (!options.wait) {
    return { revision: null, operations: [], jobId: job.id };
  }

  const finished = await deps.reactorClient.waitForJob(job.id, signal);
  if (finished.error) {
    throw new HttpError(422, "DISPATCH_FAILED", finished.error.message);
  }

  const wanted = new Map(stamped.map((action) => [action.id, action]));
  let page = await deps.reactorClient.getOperations(
    options.documentId,
    undefined,
    { sinceRevision: prior },
    { cursor: "", limit: 200 },
  );
  let matched = page.results.filter(
    (op) => op.action?.id && wanted.has(op.action.id),
  );
  // The operation log a write is read back from can lag the job that produced
  // it; poll briefly rather than reporting an empty result as success.
  for (let attempt = 0; attempt < 5 && matched.length === 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    page = await deps.reactorClient.getOperations(
      options.documentId,
      undefined,
      { sinceRevision: prior },
      { cursor: "", limit: 200 },
    );
    matched = page.results.filter(
      (op) => op.action?.id && wanted.has(op.action.id),
    );
  }
  if (matched.length === 0) {
    console.warn(
      `[http] write read-back found no operations (prior revision ${prior}, doc ${options.documentId})`,
    );
  }
  const operations = matched.map((op) => {
    const action = wanted.get(op.action.id)!;
    return {
      index: op.index,
      type: op.action.type,
      error: op.error ?? null,
      attribution: signerAddressOf(action) ? "agent" : "server",
    } as const;
  });

  const updated = await deps.reactorClient.get(options.documentId);
  return { revision: updated.header.revision, operations };
}