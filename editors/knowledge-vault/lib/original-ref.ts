import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createRef } from "@powerhousedao/reactor-attachments/client";

/**
 * SHA-256 of the bytes as lowercase hex — the attachment store's ref.
 *
 * `crypto.subtle` exists only on secure origins (`https://` and `localhost`);
 * on `http://<lan-ip>:3001` it is `undefined` and the client's own
 * `preprocess()` throws before any source is created. The pure-JS fallback
 * makes attaching work wherever Connect is opened, which a vault installed on
 * a LAN box or a remote server without TLS needs.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
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
 * The ref every source records as its original (`originalFile`):
 * `attachment://v1:<sha-256>` of the file's bytes. The same function the
 * publish uses, so a file is recognised by exactly the ref it was stored under.
 */
export async function originalRefOf(bytes: Uint8Array): Promise<string> {
  return createRef(await sha256Hex(bytes));
}
