import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * A request to a model on this computer or the local network, without Node fetch's five-minute limits. Node only:
 * the workflow piece's runner hands it to the LLM client (runner.ts); the browser vault never loads it.
 *
 * Node's fetch (undici) gives up on an answer whose headers take more than 300 s (`headersTimeout`) or whose body
 * pauses for 300 s (`bodyTimeout`), whatever the request's own signal allows. A local model sends a staged call's
 * answer in one piece once it has written all of it, often after waiting its turn behind other calls: past five
 * minutes the call failed with "fetch failed", and so did its retry, though it was allowed ten minutes
 * (LOCAL_CALL_TIMEOUT_MS). Node's http client sets no such limit; the request's signal is the only one. The
 * workflow worker's egress policy guards sockets, so it holds here as it does for fetch.
 */
export function patientFetch(input: string | URL, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}): Promise<Response> {
  const url = new URL(String(input));
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const req = send(url, { method: init.method ?? "GET", headers: init.headers, ...(init.signal ? { signal: init.signal } : {}) }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      // Cut off mid-answer (Node says "aborted"): "terminated", as fetch says it, so the caller retries it as a
      // dropped connection.
      const cutOff = (cause?: unknown) => reject(new Error("terminated: the model's answer was cut off", cause === undefined ? undefined : { cause }));
      res.on("error", cutOff);
      res.on("close", () => {
        if (!res.complete) cutOff();
      });
      res.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(name, v);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = res.statusCode ?? 502;
        const empty = status === 204 || status === 205 || status === 304;
        resolve(new Response(empty ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage ?? "", headers }));
      });
    });
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
