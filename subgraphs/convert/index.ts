import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { startConversionService, stopStartedService } from "./lib/autostart.js";
import type { ConvertRouteDeps } from "./lib/deps.js";
import { createHttpConversionService } from "./lib/service.js";
import { getResolvers, registerConvertRoutes } from "./resolvers.js";
import { schema } from "./schema.js";

/** Where autostart looks when CONVERT_SERVICE_URL is not set. */
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
    const autostart = isEnabled(process.env.CONVERT_SERVICE_AUTOSTART);
    // Autostart needs somewhere to start it: the configured URL, or the local
    // default. Without either, absence of a service is simply the state.
    const url = configuredUrl ?? (autostart ? DEFAULT_SERVICE_URL : undefined);

    if (!url) {
      this.routeDeps = {};
      registerConvertRoutes(this.http, this.routeDeps);
      return;
    }

    if (autostart && !apiKey) {
      // Probe first: anything already answering is left alone, which is what
      // keeps a reload (or an operator's own service) from being fought over.
      const { service } = await startConversionService({ url, log: console.log });
      this.routeDeps = { service };
    } else {
      this.routeDeps = {
        service: createHttpConversionService({ baseUrl: url, apiKey: apiKey || undefined }),
      };
    }

    registerConvertRoutes(this.http, this.routeDeps);
  }

  /**
   * Stop the conversion service **only if this process started it**. One that
   * was already running when we looked — a systemd unit, a container, something
   * the operator launched — is not ours to kill.
   */
  async onDisconnect(): Promise<void> {
    stopStartedService();
  }
}

/** `true`/`1`/`yes` enable a flag; anything else (including unset) leaves it off. */
function isEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}
