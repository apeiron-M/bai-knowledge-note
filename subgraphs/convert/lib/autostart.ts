import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpConversionService, type ConversionService } from "./service.js";

/**
 * Starting the conversion service for a deployment that does not run one.
 *
 * This exists because the package cannot *bundle* the engine — `docling.rs`
 * publishes no musl build, the deployment image is alpine, and it holds ~1.36 GB
 * resident once it has read a PDF. So the service is a separate process, and
 * this is the convenience for a single box: start it when nothing is there.
 *
 * It is **opt-in** (`CONVERT_SERVICE_AUTOSTART`) and **probe-first**, for two
 * reasons that are about other people's deployments rather than this one:
 *
 * 1. **Probe-first means an externally managed service always wins.** If
 *    anything answers `/health` at the configured URL, nothing is spawned and
 *    no child is held — so a systemd unit, a container, or a service the
 *    operator started by hand is never fought over.
 * 2. **Spawning contradicts horizontal scaling.** The advice for throughput is
 *    "more Switchboard replicas behind `CONVERT_SERVICE_URL`"; N replicas each
 *    spawning their own 1.36 GB engine is the opposite of that. Autostart is a
 *    dev/single-box affordance, and the flag is how it stays one.
 *
 * A watch-mode reload is the sharp edge: `ph vetra --watch` reloads the
 * Switchboard on save, so a spawn per load would leave a child per reload.
 * Probe-first is what prevents that — the second load finds the first child's
 * service and spawns nothing. `stop()` on `onDisconnect` closes the rest.
 */

/**
 * Where the service script lives, from the built output *and* from source.
 *
 * `exists` is a seam for the tests: the fallback candidates below are what stops
 * a differently-nested bundle from silently never starting anything, and there
 * is no way to exercise them against a real filesystem that has only one layout.
 */
export function resolveServiceScript(
  exists: (path: string) => boolean = existsSync,
): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // Both `dist/node/` and `subgraphs/convert/lib/` sit two levels below the
  // package root, so one expression covers the repo and the published layout.
  // The extra entries cover a bundler that emits a differently nested chunk
  // rather than making the failure mode "it silently never starts".
  const candidates = [
    join(here, "../../../scripts/docling-serve/server.ts"),
    join(here, "../../scripts/docling-serve/server.ts"),
    join(process.cwd(), "scripts/docling-serve/server.ts"),
  ];
  return candidates.find((path) => exists(path)) ?? null;
}

export interface AutostartOptions {
  /** Where the service should be reachable, e.g. `http://127.0.0.1:5011`. */
  url: string;
  waitMs?: number;
  spawnImpl?: typeof spawn;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Test seam: the path lookup normally resolves against the real filesystem. */
  resolveScript?: () => string | null;
}

export interface AutostartResult {
  service: ConversionService;
  /** Present only when this call spawned it; absent when one already answered. */
  child?: ChildProcess;
  /** True when the service was already running and left alone. */
  reused: boolean;
}

async function isHealthy(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, "")}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The child this process started, if any.
 *
 * Held module-side rather than on the subgraph instance because a watch-mode
 * reload can replace the instance while the process lives on: whoever asks to
 * stop it, and the exit guard below, must see the same handle.
 */
let startedChild: ChildProcess | null = null;
let exitGuardRegistered = false;

/** Stop the service if this process started it. Safe to call more than once. */
export function stopStartedService(): void {
  if (startedChild === null) return;
  startedChild.kill("SIGTERM");
  startedChild = null;
}

function registerExitGuard(): void {
  if (exitGuardRegistered) return;
  exitGuardRegistered = true;
  // `exit` handlers must be synchronous, and kill() is: this is the last
  // chance to avoid leaving an engine behind on a hard shutdown.
  process.once("exit", stopStartedService);
}

/**
 * Probe, and if nothing answers, start the service and wait for it to be ready.
 *
 * Never throws: a failure to start means the vault has no conversion
 * capability, which is a state it already knows how to be in, not a reason to
 * fail setup. Callers get `service` either way and can report readiness
 * through `/health`.
 */
export async function startConversionService(
  options: AutostartOptions,
): Promise<AutostartResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? spawn;
  const log = options.log ?? (() => {});
  const waitMs = options.waitMs ?? 20_000;
  const url = options.url.replace(/\/+$/, "");
  const service = createHttpConversionService({ baseUrl: url });

  if (await isHealthy(url, fetchImpl)) {
    log(`[convert] reusing the service already at ${url}`);
    return { service, reused: true };
  }

  const script = (options.resolveScript ?? resolveServiceScript)();
  if (!script) {
    log("[convert] autostart is on but scripts/docling-serve/server.ts was not found");
    return { service, reused: false };
  }

  const port = new URL(url).port;
  log(`[convert] starting the conversion service: ${script} (port ${port})`);

  let child: ChildProcess;
  try {
    child = spawnImpl(process.execPath, [script], {
      env: { ...process.env, CONVERT_SERVICE_PORT: port },
      // The service's own log lines are worth seeing where the Switchboard's are.
      stdio: "inherit",
    });
  } catch (error) {
    log(`[convert] could not start the service: ${String(error)}`);
    return { service, reused: false };
  }

  // Wait for readiness by asking the service, not by waiting a fixed time: it
  // loads no models at start-up, so this usually answers on the first probe.
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url, fetchImpl)) {
      log(`[convert] the service is up at ${url}`);
      startedChild = child;
      registerExitGuard();
      return { service, child, reused: false };
    }
    await sleep(250);
  }

  log(`[convert] the service did not answer within ${waitMs} ms`);
  // It was spawned but never became ready: keep the handle so `stop()` can
  // clean it up, but say so rather than pretending it works.
  startedChild = child;
  registerExitGuard();
  return { service, child, reused: false };
}