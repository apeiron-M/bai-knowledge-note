import { createHttpConversionService, type ConversionService } from "./service.js";

/**
 * Reaching the conversion service, which this package no longer ships.
 *
 * The engine lives in its own repository and deploys as its own container
 * image; the vault knows it only by URL. Two facts forced that split and both
 * are worth keeping in view, because each one on its own would have been an
 * argument for bundling it:
 *
 * 1. **It cannot run in the Switchboard image.** `docling.rs` publishes
 *    `linux-x64-gnu`, `linux-arm64-gnu` and `win32-x64-msvc` — no musl build —
 *    and the deployment image is alpine. A bundled engine would install
 *    silently (it was an `optionalDependency`) and then never load.
 * 2. **It should not, either.** The binding keeps ~1.36 GB of ONNX weights
 *    resident once it has read a PDF, and the advice for throughput is "more
 *    Switchboard replicas behind `CONVERT_SERVICE_URL`". N replicas each
 *    carrying their own engine is the opposite of that.
 *
 * So this module probes and reports. It does **not** spawn: an earlier version
 * started `scripts/docling-serve/server.ts` as a child, which only ever worked
 * on a single dev box and duplicated the engine's source inside this package.
 *
 * Absence is a state, not a failure. `GET convert/health` distinguishes
 * `configured: false` (nobody pointed us at a service) from `ok: false` (we were
 * pointed at one and it did not answer), and a vault with neither still works —
 * only this capability is missing.
 */

export interface ProbeOptions {
  /** Where the service should be reachable, e.g. `http://127.0.0.1:5011`. */
  url: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** How long to wait for `/health` before calling it unreachable. */
  timeoutMs?: number;
}

export interface ProbeResult {
  service: ConversionService;
  /** True when `/health` answered. False means configured but not reachable. */
  reachable: boolean;
}

async function isHealthy(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Build the client and say plainly whether anything is there.
 *
 * The service is returned either way. Returning `undefined` when the probe
 * fails would collapse "unreachable right now" into "not configured", and those
 * need different answers: a service that is merely slow to boot, or restarting,
 * should start working without the Switchboard being restarted too. So the
 * client is always wired, and `/convert/health` reports the live truth.
 */
export async function connectConversionService(
  options: ProbeOptions,
): Promise<ProbeResult> {
  const {
    url,
    fetchImpl = fetch,
    log = () => {},
    timeoutMs = 2_000,
  } = options;

  const service = createHttpConversionService({ baseUrl: url });
  const reachable = await isHealthy(url, fetchImpl, timeoutMs);

  if (!reachable) {
    log(
      `[convert] no conversion service answered at ${url} — document upload will be unavailable until one does. ` +
        `Run the image (docker run -p 5011:5011 -v docling-models:/models <docling-service>) and point CONVERT_SERVICE_URL at it.`,
    );
  }

  return { service, reachable };
}
