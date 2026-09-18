import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { connectConversionService } from "./lib/probe.js";
import type { ConvertRouteDeps } from "./lib/deps.js";
import { createHttpConversionService } from "./lib/service.js";
import { getResolvers, registerConvertRoutes } from "./resolvers.js";
import { schema } from "./schema.js";

/** Assumed when CONVERT_SERVICE_LOCAL is set and no explicit URL is given. */
const DEFAULT_SERVICE_URL = "http://127.0.0.1:5011";

/**
 * The conversion proxy.
 *
 * It holds **no** vault vocabulary and creates nothing: it converts bytes into
 * markdown and docling chunks, and derives the *sections* those chunks would
 * become. Deciding what a source is stays above this boundary.
 *
 * Why the engine is a separate process rather than a dependency here: the
 * binding keeps hundreds of megabytes of ONNX models resident once it has read
 * a PDF, the Switchboard should not carry that, and `docling.rs` publishes no
 * musl build while the deployment image is alpine. This subgraph talks to it
 * over HTTP, so the engine is replaceable without touching vault code.
 */
export class ConvertSubgraph extends BaseSubgraph {
  name = "convert";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};

  /**
   * Read by the resolvers and handed to the routes. Empty when no service is
   * configured, which is a supported state, not an error.
   */
  routeDeps: ConvertRouteDeps = {};

  /**
   * The one place configuration is read.
   *
   * `onSetup` rather than a handler, because the client is long-lived — it
   * holds the base URL, key and timeout — and building one per request would
   * re-read the environment on every conversion.
   *
   * `CONVERT_SERVICE_URL` unset ⇒ `{}`: `GET convert/health` reports
   * `configured: false` and `POST convert` answers 503. A vault that has not
   * been pointed at a service still works; only this capability is absent.
   */
  async onSetup(): Promise<void> {
    const configuredUrl = process.env.CONVERT_SERVICE_URL?.trim();
    const apiKey = process.env.CONVERT_SERVICE_API_KEY?.trim();
    // `CONVERT_SERVICE_AUTOSTART` is the historical spelling. It no longer
    // starts anything — the engine is its own image now — but it still means
    // "assume the service is on localhost", so honouring it keeps existing
    // development environments working rather than silently going dark.
    const useLocalDefault =
      isEnabled(process.env.CONVERT_SERVICE_LOCAL) ||
      isEnabled(process.env.CONVERT_SERVICE_AUTOSTART);
    const url = configuredUrl ?? (useLocalDefault ? DEFAULT_SERVICE_URL : undefined);

    if (!url) {
      this.routeDeps = {};
      registerConvertRoutes(this.http, this.routeDeps);
      return;
    }

    if (apiKey) {
      // An authenticated service is a managed one: it is somebody's deployment,
      // so probing it at boot to print a warning earns nothing.
      this.routeDeps = {
        service: createHttpConversionService({ baseUrl: url, apiKey }),
      };
    } else {
      const { service } = await connectConversionService({
        url,
        log: console.log,
      });
      this.routeDeps = { service };
    }

    registerConvertRoutes(this.http, this.routeDeps);
  }

}

/** `true`/`1`/`yes` enable a flag; anything else (including unset) leaves it off. */
function isEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}
