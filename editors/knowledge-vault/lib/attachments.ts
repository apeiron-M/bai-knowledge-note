import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getBearerToken } from "../../shared/authed-fetch.js";
import {
  createAttachmentClient,
  createRef,
  createRemoteAttachmentService,
  type IAttachmentClient,
  type IAttachmentService,
  type PreprocessResult,
} from "@powerhousedao/reactor-attachments/client";
import { setAttachmentService } from "@powerhousedao/reactor-browser";
import { useCallback, useEffect, useMemo } from "react";
import { resolveSwitchboardOrigin } from "../../shared/subgraph-endpoint.js";
import type { AttachmentPort } from "./intake-service.js";

/**
 * Ported from umh-production-ledger's `lib/attachments.ts`, which is proven —
 * with one structural change, made after a measured failure.
 *
 * Connect only constructs an attachment service when a default drive is
 * configured (it scrapes the Switchboard origin out of that drive's URL). A
 * document living in a local, browser-only drive gets no attachment service at
 * all, and reading an attachment fails with "AttachmentClient not available".
 * So point a service at the paired Switchboard ourselves — the store is
 * drive-independent, at `<origin>/attachments/*`. Never overrides a service
 * Connect already provided.
 *
 * **Why the client is built at call time, not taken from a hook.**
 * `setAttachmentService()` does not write `window.ph.attachmentService`; it
 * dispatches a `ph:setAttachmentService` DOM event, and a separately registered
 * handler writes the value that `useAttachmentService()` then reads through
 * `useSyncExternalStore`. `useAttachmentUpload()`'s `preprocess` closes over
 * the client resolved on *that* render, so a port memoised before the event
 * round-trip lands — or on a page where the handler was never registered —
 * carries no client and throws "AttachmentClient not available" on first use.
 * Measured: an intake publish created its sources but dispatched no
 * `ATTACH_ORIGINAL_FILE` at all, because `prepare()` threw exactly that. The
 * ledger tolerates the timing because its hooks live inside one editor; the
 * intake's port lives in `DriveExplorer` and is memoised once. Resolving the
 * service when `prepare` is called removes the dependency on render timing
 * entirely; the module-level reference removes the dependency on the event
 * handler.
 */
type PhWindow = {
  ph?: {
    attachmentService?: IAttachmentService;
    renown?: {
      user?: unknown;
      getBearerToken: (options: {
        expiresIn: number;
      }) => Promise<string | undefined>;
    };
  };
};

const phWindow = (): PhWindow | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as PhWindow);

/** The service this module created, if Connect had not provided one. */
let ownService: IAttachmentService | null = null;

/**
 * The service to use right now: Connect's if it has one, otherwise ours —
 * created on first need and also announced through `setAttachmentService` so
 * the rest of the app (previews, the reactor's own hooks) sees the same one.
 * Returns `null` only off a known host, where there is nothing to point at.
 */
export function getAttachmentService(): IAttachmentService | null {
  const ph = phWindow()?.ph;
  if (ph?.attachmentService) return ph.attachmentService;
  if (ownService) return ownService;
  const origin = resolveSwitchboardOrigin();
  if (!origin) return null;
  ownService = createRemoteAttachmentService({
    remoteUrl: origin,
    jwtHandler: async () => {
      const renown = phWindow()?.ph?.renown;
      if (!renown?.user) return undefined;
      return renown.getBearerToken({ expiresIn: 10 });
    },
  });
  setAttachmentService(ownService);
  return ownService;
}

/**
 * A service that reads straight from the Switchboard with the bearer, whatever
 * Connect's own service thinks. Connect's is local-first and learns refs by
 * syncing; a figure published seconds ago can be "missing" to it while the
 * bytes are already in the store (measured: 404s in the page, 200 with the
 * same client from a script). Reads fall back to this one. Not announced
 * through `setAttachmentService`: it is a second opinion, not the app's service.
 */
let remoteReader: IAttachmentService | null = null;
export function getRemoteAttachmentReader(): IAttachmentService | null {
  if (remoteReader) return remoteReader;
  const origin = resolveSwitchboardOrigin();
  if (!origin) return null;
  remoteReader = createRemoteAttachmentService({
    remoteUrl: origin,
    jwtHandler: async () => {
      const renown = phWindow()?.ph?.renown;
      if (!renown?.user) return undefined;
      return renown.getBearerToken({ expiresIn: 10 });
    },
  });
  return remoteReader;
}

/** Kept for callers that want the service registered at mount; idempotent. */
export function ensureAttachmentService(): void {
  void getAttachmentService();
}

function clientOrThrow(): IAttachmentClient {
  const service = getAttachmentService();
  if (!service) {
    throw new Error(
      "No attachment service: the Switchboard origin could not be resolved from this page's host.",
    );
  }
  return createAttachmentClient(service);
}

/**
 * SHA-256 of the bytes as lowercase hex — the attachment store's ref.
 *
 * `crypto.subtle` exists only on secure origins (`https://` and `localhost`);
 * on `http://<lan-ip>:3001` it is `undefined` and the client's own
 * `preprocess()` throws before any source is created. The pure-JS fallback
 * makes attaching work wherever Connect is opened, which a vault installed on
 * a LAN box or a remote server without TLS needs.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // The DOM types say `crypto.subtle` always exists; browsers disagree on
  // insecure origins, where it is `undefined`. Typed as the runtime behaves.
  const subtle = (globalThis.crypto as { subtle?: SubtleCrypto } | undefined)
    ?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return bytesToHex(sha256(bytes));
}

/**
 * What the client's `preprocess()` returns, built here so the hash can fall
 * back: the ref, the hash, the size, the reservation options, and the bytes as
 * a fresh stream each time the upload asks.
 */
async function preprocessBytes(file: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<PreprocessResult> {
  const hash = await sha256Hex(file.bytes);
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(file.bytes);
        controller.close();
      },
    });
  return {
    ref: createRef(hash),
    hash,
    sizeBytes: file.bytes.byteLength,
    options: {
      mimeType: file.mimeType,
      fileName: file.name,
      clientHash: hash,
      sizeBytes: file.bytes.byteLength,
    },
    data: stream(),
    stream,
  };
}

/**
 * The real `AttachmentPort` for the intake: `prepare` is the content-addressed
 * ref, `upload` sends the bytes. Split in two because the ref is known before
 * the upload — the sources can exist and point at the original while 30 MB is
 * still streaming (convert spec §12.1).
 *
 * The bytes are wrapped in a `File`, not a `Blob`: the client records
 * `file.name` as the attachment's `fileName` and falls back to the literal
 * string "attachment" for a nameless Blob.
 */
export function useAttachmentPort(): AttachmentPort {
  useEffect(() => {
    ensureAttachmentService();
  }, []);

  return useMemo<AttachmentPort>(
    () => ({
      async prepare(file) {
        clientOrThrow(); // fail here, before any source exists, if there is nowhere to upload to
        const result = await preprocessBytes(file);
        return { ref: result.ref, result };
      },
      async upload(prepared) {
        const { result } = prepared as { result?: PreprocessResult };
        if (!result) throw new Error("upload() needs the result of prepare()");
        await clientOrThrow().upload({ preprocessed: result });
      },
    }),
    [],
  );
}

/**
 * Resolves an `attachment://` ref to an object URL and its mime type. The
 * caller owns the URL and revokes it (`URL.revokeObjectURL`) when done.
 *
 * Unlike the ledger, no `application/pdf` default: a vault source may be any
 * of 29 formats, and the panel decides render-or-download from the real type.
 */
export function useAttachmentLoader() {
  useEffect(() => {
    ensureAttachmentService();
  }, []);

  return useCallback(
    async (ref: string): Promise<{ url: string; mimeType: string }> => {
      const service = getAttachmentService();
      if (!service) throw new Error("Attachment service is not available");
      // A source can be opened while its figures are still uploading (73
      // PUTs after publish, measured): the store answers 404 for a ref the
      // content already carries. Retry with backoff before calling it
      // unavailable — ~40 s in all, which covers a publish of a long paper.
      const delays = [1_500, 3_000, 5_000, 8_000, 10_000, 12_000];
      const refArg = ref as Parameters<IAttachmentService["get"]>[0];
      const remote = getRemoteAttachmentReader();
      let response: Awaited<ReturnType<IAttachmentService["get"]>> | null =
        null;
      for (let attempt = 0; ; attempt++) {
        try {
          response = await service.get(refArg);
          break;
        } catch (error) {
          // Second opinion before waiting: the store itself, with the bearer.
          if (remote && remote !== service) {
            try {
              response = await remote.get(refArg);
              break;
            } catch {
              // fall through to the retry below
            }
          }
          if (attempt >= delays.length) throw error;
          await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
      }
      const buffer = await new Response(response.body).arrayBuffer();
      const mimeType = response.header.mimeType || "application/octet-stream";
      return {
        url: URL.createObjectURL(new Blob([buffer], { type: mimeType })),
        mimeType,
      };
    },
    [],
  );
}

// --- inline images: bytes → data URL, cached, with a direct-fetch fallback -----

const SERVICE_GET_DEADLINE_MS = 4_000;
const DIRECT_FETCH_DEADLINE_MS = 20_000;

function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const dataUrlCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

/** `attachment://v1:<hash>` → `<hash>`, or null when the ref is not one. */
export function attachmentHash(ref: string): string | null {
  const m = /^attachment:\/\/v\d+:([0-9a-f]+)$/i.exec(ref.trim());
  return m ? m[1] : null;
}

async function bearerToken(): Promise<string | undefined> {
  // The same provider the vault's REST calls (intake, health) authenticate
  // with — proven in this UI — bounded so a stalled wallet cannot hang a load.
  try {
    return await withDeadline(
      getBearerToken(),
      SERVICE_GET_DEADLINE_MS,
      "bearer token did not arrive in time",
    );
  } catch {
    return undefined;
  }
}

/** Refs whose fetch failed on this page, with the reason — shown instead of retried on every remount. */
const failedRefs = new Map<string, { reason: string; at: number }>();
const FAILURE_TTL_MS = 60_000;

export function attachmentFailure(ref: string): string | undefined {
  const failed = failedRefs.get(ref);
  if (!failed) return undefined;
  if (Date.now() - failed.at > FAILURE_TTL_MS) {
    failedRefs.delete(ref);
    return undefined;
  }
  return failed.reason;
}

/**
 * The attachment's bytes as a data URL, for an <img> that must never break:
 * a data URL cannot be revoked or expire, so no re-render, remount or
 * StrictMode double-mount can take the picture away once it is in.
 *
 * Bytes come from Connect's attachment service when it answers; when it does
 * not, from the Switchboard directly — `GET <origin>/attachments/<hash>` with
 * the Renown bearer, the request that is verified to return the bytes for
 * refs the local-first service reports missing. One fetch per ref per page,
 * shared by every preview that shows the same picture.
 */
// Previews subscribe to "an attachment arrived (or failed)" and re-render, so
// the renderer writes `src` from the cache into the HTML. Setting `src` on a
// DOM node from a promise was fragile: the editor is double-mounted in dev and
// re-created every few seconds, and the node the promise held was often gone.
const listeners = new Set<() => void>();
let attachmentsVersion = 0;
function notifyAttachmentChange(): void {
  attachmentsVersion += 1;
  for (const listener of listeners) listener();
}
export function subscribeAttachments(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getAttachmentsVersion(): number {
  return attachmentsVersion;
}

/** The data URL if this page already fetched the ref — synchronous, for the renderer. */
export function cachedAttachmentDataUrl(ref: string): string | undefined {
  return dataUrlCache.get(ref);
}

export function fetchAttachmentDataUrl(ref: string): Promise<string> {
  const cached = dataUrlCache.get(ref);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(ref);
  if (pending) return pending;
  const task = (async () => {
    try {
      const { bytes, mimeType } = await fetchAttachmentBytes(ref);
      const url = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
      dataUrlCache.set(ref, url);
      failedRefs.delete(ref);
      notifyAttachmentChange();
      return url;
    } catch (error) {
      // Remembered: the editor is re-created every few seconds, and a failure
      // that is only reported to the mount that started it is never seen.
      failedRefs.set(ref, {
        reason: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
      notifyAttachmentChange();
      throw error;
    }
  })().finally(() => inFlight.delete(ref));
  inFlight.set(ref, task);
  return task;
}

async function fetchAttachmentBytes(
  ref: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const errors: string[] = [];
  const service = getAttachmentService();
  if (service) {
    try {
      // Connect's service is local-first and, for a ref it once saw as
      // "pending", waits for the bytes to arrive rather than failing — in the
      // page that looked like a spinner that never ended (measured: the
      // Switchboard had answered 200 for the same hash all along). A deadline
      // turns that wait into the fallback below.
      const response = await withDeadline(
        service.get(ref as Parameters<IAttachmentService["get"]>[0]),
        SERVICE_GET_DEADLINE_MS,
        "attachment service did not answer in time",
      );
      const buffer = await withDeadline(
        new Response(response.body).arrayBuffer(),
        SERVICE_GET_DEADLINE_MS,
        "attachment service body did not arrive in time",
      );
      if (buffer.byteLength > 0) {
        return {
          bytes: new Uint8Array(buffer),
          mimeType: response.header.mimeType || "application/octet-stream",
        };
      }
      errors.push("attachment service returned an empty body");
    } catch (error) {
      errors.push(
        `attachment service: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    errors.push("no attachment service on this page");
  }

  const hash = attachmentHash(ref);
  const origin = resolveSwitchboardOrigin();
  if (!hash) throw new Error(`${errors.join("; ")}; not an attachment ref`);
  if (!origin)
    throw new Error(
      `${errors.join("; ")}; Switchboard origin unknown for this host`,
    );
  const token = await bearerToken();
  const response = await fetch(`${origin}/attachments/${hash}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(DIRECT_FETCH_DEADLINE_MS),
  });
  if (!response.ok) {
    throw new Error(
      `${errors.join("; ")}; direct GET ${origin}/attachments/${hash.slice(0, 8)}… → ${response.status}${token ? "" : " (no bearer: not signed in)"}`,
    );
  }
  const buffer = await response.arrayBuffer();
  return {
    bytes: new Uint8Array(buffer),
    mimeType:
      response.headers.get("content-type")?.split(";")[0] ||
      "application/octet-stream",
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
