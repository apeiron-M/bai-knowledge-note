/**
 * The package's REST surface, served inside the page: the same routes the
 * Switchboard registers (subgraphs/http/register.ts and the convert routes),
 * on an in-page HTTP scope, over the in-page engine. File conversion runs on
 * docling.rs's WebAssembly build.
 */
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { KeptResults } from "../subgraphs/convert/lib/kept.js";
import { registerConvertRoutes } from "../subgraphs/convert/resolvers.js";
import { registerHttpRoutes } from "../subgraphs/http/register.js";
import { createDoclingService } from "./docling-service.js";
import { createPageHttpScope } from "./http-scope.js";
import { VISITOR } from "./page-subgraph.js";

/** The largest file the browser vault takes, as the vault's own default. */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** Finished conversions kept for a page that comes back for them — in memory: the page is the only reader. */
function memoryKept(): KeptResults {
  const answers = new Map<string, { owner: string; status: number; body: string }>();
  const running = new Map<string, string>();
  return {
    begin: (job, owner) => {
      running.set(job, owner);
    },
    keep: (job, status, body) => {
      const owner = running.get(job) ?? VISITOR.address;
      running.delete(job);
      answers.set(job, { owner, status, body });
      return Promise.resolve();
    },
    read: (job, owner) => {
      if (running.get(job) === owner) return Promise.resolve({ kind: "running" as const });
      const answer = answers.get(job);
      if (!answer || answer.owner !== owner) return Promise.resolve(null);
      return Promise.resolve(
        answer.status === 200
          ? { kind: "done" as const, body: answer.body }
          : { kind: "failed" as const, status: answer.status, body: answer.body },
      );
    },
  };
}

export function createRestService(subgraph: BaseSubgraph, baseUrl: string) {
  const page = createPageHttpScope(baseUrl);
  registerHttpRoutes(page.scope, subgraph);
  registerConvertRoutes(page.scope, {
    service: createDoclingService(),
    source: "runtime",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    kept: memoryKept(),
  });
  return async (request: Request, path: string): Promise<Response> =>
    (await page.handle(request, path, VISITOR)) ??
    Response.json({ error: `${request.method} ${path} is not served by the browser vault.`, code: "NOT_FOUND" }, { status: 404 });
}
