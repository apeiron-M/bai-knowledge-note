import type { PHDocument } from "document-model";
import type { Action } from "document-model";
import type { CanonicalDocumentId } from "@powerhousedao/reactor-api";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { requireUser } from "./authorize.js";
import type { HttpRouteDeps } from "./deps.js";
import { stampActions, type RawAction } from "./envelope.js";
import { lintActions } from "./lint/index.js";
import { HttpError } from "./respond.js";
import { validateEnvelopes } from "./validate.js";

export interface WriteResult {
  revision: unknown;
  operations: {
    index: number;
    type: string;
    error: string | null;
    attribution: "agent" | "server";
  }[];
  /**
   * Whether the dispatched actions were observed in the operation log.
   *
   * `unconfirmed` means the write WAS dispatched and its job reported success,
   * but the log could not be read back in time. Callers must not retry on it:
   * the actions are not idempotent and may already have applied. Poll `jobId`
   * or re-read the document instead.
   */
  readBack: "confirmed" | "unconfirmed" | "skipped";
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

const READ_BACK_PAGE_SIZE = 200;
const MAX_READ_BACK_PAGES = 5;
const READ_BACK_BACKOFF_MS = [50, 100, 200, 400, 800];

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

  // Envelope first: a malformed or duplicated action id is refused here rather
  // than forwarded to the reactor, which would answer 422 after dispatching.
  const findings = [
    ...validateEnvelopes(options.actions),
    ...lintActions(documentType, options.document.state, options.actions, {
      allowLiteralEscapes: options.allowLiteralEscapes,
    }),
  ];
  if (findings.length) {
    const code = findings.some((f) => f.class === "REACTOR_REJECTS")
      ? "LINT_REACTOR"
      : "LINT_CONVENTION";
    // Lead with the first finding. "3 lint findings" tells the caller nothing;
    // the path and the reason are what they need to fix it.
    const first = findings[0];
    const more =
      findings.length > 1 ? ` (+${findings.length - 1} more)` : "";
    throw new HttpError(
      400,
      code,
      `${first.path}: ${first.message}${more}`,
      findings,
    );
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

  // `sinceRevision` filters a PER-SCOPE operation index, so the floor must be
  // read per scope. Taking Math.min across the whole revision map mixes scopes:
  // a freshly created document is `{ document: 2 }` with no `global` entry, so
  // the floor came out as 2 and silently excluded that document's very first
  // global operation (index 0) from its own read-back — reported as a clean
  // write with an empty `operations` array.
  const revision = (options.document.header.revision ?? {}) as Record<
    string,
    number
  >;
  const writtenScopes = new Set(
    stamped.map(
      (action) => action.scope ?? options.defaultScope ?? "global",
    ),
  );
  const prior = Math.min(
    ...[...writtenScopes].map((scope) => revision[scope] ?? 0),
  );
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
    return {
      revision: null,
      operations: [],
      readBack: "skipped",
      jobId: job.id,
    };
  }

  const finished = await deps.reactorClient.waitForJob(job.id, signal);
  if (finished.error) {
    throw new HttpError(422, "DISPATCH_FAILED", finished.error.message);
  }

  const wanted = new Map(stamped.map((action) => [action.id, action]));

  // `action` is optional on purpose: the operation log can return records
  // whose action envelope is absent, which is why the id is guarded below.
  type LoggedOperation = {
    index: number;
    error?: string | null;
    action?: { id: string; type: string };
  };

  // One sweep of the log, following the cursor: a busy document can push the
  // operations we just wrote off the first page.
  const sweep = async (): Promise<LoggedOperation[]> => {
    const found: LoggedOperation[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_READ_BACK_PAGES; page++) {
      const result = (await deps.reactorClient.getOperations(
        options.documentId,
        undefined,
        { sinceRevision: prior },
        { cursor, limit: READ_BACK_PAGE_SIZE },
      )) as unknown as {
        results: LoggedOperation[];
        nextCursor?: string;
      };
      found.push(
        ...result.results.filter(
          (op) => op.action?.id && wanted.has(op.action.id),
        ),
      );
      if (found.length >= wanted.size || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return found;
  };

  // The operation log can lag the job that produced it. Back off rather than
  // hammering at a flat interval, so the common case returns fast.
  let matched = await sweep();
  for (const delay of READ_BACK_BACKOFF_MS) {
    if (matched.length) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    matched = await sweep();
  }

  const readBack: WriteResult["readBack"] = matched.length
    ? "confirmed"
    : "unconfirmed";
  if (readBack === "unconfirmed") {
    console.warn(
      `[http] write read-back found no operations (doc ${options.documentId}, ` +
        `scopes ${[...writtenScopes].join(",")}, sinceRevision ${prior}, job ${job.id})`,
    );
  }
  const operations = matched.map((op) => {
    const action = wanted.get(op.action!.id)!;
    return {
      index: op.index,
      type: op.action!.type,
      error: op.error ?? null,
      attribution: signerAddressOf(action) ? "agent" : "server",
    } as const;
  });

  const updated = await deps.reactorClient.get(options.documentId);
  return {
    revision: updated.header.revision,
    operations,
    readBack,
    jobId: job.id,
  };
}
