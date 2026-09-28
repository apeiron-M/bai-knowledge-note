/**
 * Logs a step of a request that took longer than `SLOW_STEP_MS`.
 *
 * Written to find a 37–40 s stall on the first write after every Switchboard
 * boot (2026-09-28): reads were instant, and the job itself took ~3 s once
 * dispatched, so the time was spent somewhere between the route and the
 * reactor's queue. The log names the step instead of leaving it to guesswork.
 * Quiet on the fast path — nothing is printed for a step under the threshold.
 */
export const SLOW_STEP_MS = 2000;

export async function timed<T>(
  label: string,
  work: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const started = now();
  try {
    return await work();
  } finally {
    const elapsed = now() - started;
    if (elapsed >= SLOW_STEP_MS) {
      console.warn(`[http] slow step: ${label} took ${elapsed} ms`);
    }
  }
}

type RouteHandler<C> = (request: Request, ctx: C) => Response | Promise<Response>;

/**
 * Wraps a route handler so a slow request says where its time went:
 *
 * - `reached handler N ms after the client sent it` — time spent in the host
 *   before our code runs (bearer verification, and for `body: "parsed"` routes
 *   buffering the body with `readBody`). Measured only when the client sends
 *   `x-client-sent-at` (epoch ms), so an ordinary caller costs nothing.
 * - `handler took N ms` — our own code, including `request.json()`.
 */
export function timedRoute<C>(
  label: string,
  handler: RouteHandler<C>,
  now: () => number = Date.now,
): RouteHandler<C> {
  return async (request, ctx) => {
    const entered = now();
    const sentAt = Number(request.headers.get("x-client-sent-at"));
    if (Number.isFinite(sentAt) && sentAt > 0 && entered - sentAt >= SLOW_STEP_MS) {
      console.warn(
        `[http] slow step: ${label} reached handler ${entered - sentAt} ms after the client sent it`,
      );
    }
    try {
      return await handler(request, ctx);
    } finally {
      const elapsed = now() - entered;
      if (elapsed >= SLOW_STEP_MS) {
        console.warn(`[http] slow step: ${label} handler took ${elapsed} ms`);
      }
    }
  };
}
