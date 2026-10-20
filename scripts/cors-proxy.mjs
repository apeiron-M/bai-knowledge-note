#!/usr/bin/env node
/**
 * A CORS front door for a local model server.
 *
 * The vault's chat calls the model endpoint straight from the browser, so the
 * server has to allow the Connect origin. Model harnesses often do not: they
 * are built for terminals and SDKs, where CORS does not exist. The browser
 * then reports a bare "Failed to fetch" — indistinguishable from the server
 * being down.
 *
 * This forwards every request to the real server and adds the headers a
 * browser needs, answering the preflight itself. Responses are piped, not
 * buffered, so token streaming still arrives token by token.
 *
 * Run it beside the model server — on Windows if the model runs on Windows,
 * because 127.0.0.1 there is a different machine than 127.0.0.1 in WSL:
 *
 *   node scripts/cors-proxy.mjs --target http://127.0.0.1:8081 --port 8090
 *
 * then point the vault's chat at http://127.0.0.1:8090/v1.
 */
import http from "node:http";
import { argv, exit } from "node:process";

function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

const port = Number(arg("port", "8090"));
const target = arg("target", "http://127.0.0.1:8080");
let upstream;
try {
  upstream = new URL(target);
} catch {
  console.error(`--target must be a URL, e.g. http://127.0.0.1:8081 (got "${target}")`);
  exit(1);
}

/** Echo the caller's origin so credentialed requests work too. */
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ?? "authorization, content-type",
  );
  res.setHeader("Access-Control-Max-Age", "600");
}

const server = http.createServer((req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const headers = { ...req.headers, host: upstream.host };
  delete headers["accept-encoding"]; // pipe the body through untouched
  const proxied = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      // The upstream's own CORS headers would override ours; drop them.
      const out = { ...upstreamRes.headers };
      for (const k of Object.keys(out)) {
        if (k.toLowerCase().startsWith("access-control-")) delete out[k];
      }
      res.writeHead(upstreamRes.statusCode ?? 502, out);
      upstreamRes.pipe(res);
    },
  );
  proxied.on("error", (err) => {
    console.error(`[cors-proxy] ${req.method} ${req.url} → ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `cannot reach ${upstream.origin}: ${err.message}` }));
  });
  req.pipe(proxied);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[cors-proxy] http://127.0.0.1:${port}  →  ${upstream.origin}`);
  console.log(`[cors-proxy] point the vault's chat at http://127.0.0.1:${port}/v1`);
});
