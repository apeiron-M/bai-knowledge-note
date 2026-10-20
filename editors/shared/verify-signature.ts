/**
 * Verify a Powerhouse operation signature in the browser, from data alone.
 *
 * Every operation the reactor stores carries `action.context.signer` with a
 * `signatures[]` list. Each signature is a 5-tuple, transported joined by
 * ", ":
 *
 *   [ timestamp, did:key, actionHash, prevStateHash, 0xsignature ]
 *
 * and the signed message is (see `@renown/sdk` `RenownCryptoSigner`):
 *
 *   "\x19Signed Operation:\n" + len(params) + params    where
 *   params = timestamp + did + actionHash + prevStateHash   (concatenated)
 *
 * (The leading 0x19 byte is the EIP-191 convention that keeps a signed
 * operation from ever being a valid transaction or a plain message; it is
 * invisible in most terminals, which is how it goes missing in re-
 * implementations.)
 *
 * signed with ECDSA on P-256 over SHA-256, the signature as raw `r||s`
 * (64 bytes) in hex. The did:key is a multibase (base58btc, `z`) multicodec
 * (`0x8024`, p256-pub) compressed point. So a reader holding nothing but
 * the tuple can check that the key it names really produced it — no
 * server, no trust in the projection that stored it.
 *
 * What this proves, and what it does not:
 *
 *   - PROVES: the holder of the did:key's private key signed exactly this
 *     (timestamp, actionHash, prevStateHash) — the operation was not
 *     forged or altered by whoever stored or relayed it.
 *   - `actionHash` is `base64(sha256(scope + type + JSON.stringify(input)))`;
 *     `verifyActionHash` recomputes it from the stored input so a reader can
 *     also confirm the signature covers THIS input, not some other.
 *   - DOES NOT PROVE: that the did:key belongs to the `user.address` stamped
 *     beside it. That binding is a Renown credential (the app key is
 *     authorised by the wallet); checking it needs Renown's read model.
 *     Display the address as "claimed by the signing app", not as verified.
 */

export type SignatureTuple = [
  timestamp: string,
  did: string,
  actionHash: string,
  prevStateHash: string,
  signatureHex: string,
];

export type VerificationResult =
  | { status: "unsigned" }
  | { status: "verified"; did: string; signedAt: Date }
  | { status: "invalid"; reason: string }
  | { status: "unsupported"; reason: string };

const SEPARATOR = ", ";

/** Split a transported signature into its 5 params; short input is padded. */
export function parseSignature(
  signature: string | string[] | null | undefined,
): SignatureTuple | null {
  if (signature == null) return null;
  const parts = Array.isArray(signature) ? signature : signature.split(SEPARATOR);
  if (parts.length < 5 && (Array.isArray(signature) ? parts.length === 0 : signature.trim() === "")) return null;
  const padded = Array.from({ length: 5 }, (_u, i) => parts[i] ?? "");
  return padded as SignatureTuple;
}

/** EIP-191-style domain prefix, byte-for-byte what `@renown/sdk` signs. */
export const SIGNED_OPERATION_PREFIX = "\u0019Signed Operation:\n";

export function buildSignatureMessage(params: readonly string[]): Uint8Array {
  const message = params.join("");
  const prefix = SIGNED_OPERATION_PREFIX + message.length.toString();
  return new TextEncoder().encode(prefix + message);
}

/* ------------------------------------------------------------------ */
/*  did:key → raw P-256 public key                                    */
/* ------------------------------------------------------------------ */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map<string, number>(
  Array.from(B58, (c, i): [string, number] => [c, i]),
);

export function base58Decode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [];
  for (const ch of input) {
    const value = B58_MAP.get(ch);
    if (value === undefined) throw new Error(`Invalid base58 character: ${ch}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's are leading zero bytes.
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// P-256 curve parameters (secp256r1).
const P = BigInt(
  "0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
);
const B = BigInt(
  "0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b",
);

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** 33-byte compressed point → 65-byte uncompressed (0x04 || x || y). */
export function decompressP256(compressed: Uint8Array): Uint8Array {
  if (compressed.length !== 33) {
    throw new Error(`Expected a 33-byte compressed point, got ${compressed.length}`);
  }
  const prefix = compressed[0];
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error(`Invalid compressed point prefix 0x${prefix.toString(16)}`);
  }
  const x = bytesToBigInt(compressed.subarray(1));
  // y² = x³ − 3x + b (mod p); p ≡ 3 (mod 4) so sqrt(a) = a^((p+1)/4).
  const rhs = mod(x * x * x - 3n * x + B, P);
  let y = modPow(rhs, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== rhs) throw new Error("Point is not on P-256");
  const wantOdd = prefix === 0x03;
  if ((y & 1n) === 1n !== wantOdd) y = P - y;
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(bigIntTo32Bytes(x), 1);
  out.set(bigIntTo32Bytes(y), 33);
  return out;
}

/** `did:key:z…` (p256-pub multicodec) → raw uncompressed public key bytes. */
export function publicKeyFromDidKey(did: string): Uint8Array {
  const parts = did.split(":");
  if (parts.length < 3 || parts[0] !== "did" || parts[1] !== "key") {
    throw new Error(`Not a did:key: ${did}`);
  }
  const multibase = parts[2];
  if (!multibase.startsWith("z")) {
    throw new Error(`Unsupported multibase prefix '${multibase[0] ?? ""}'`);
  }
  const decoded = base58Decode(multibase.slice(1));
  // varint(0x1200) = 0x80 0x24 — the p256-pub multicodec.
  if (decoded[0] !== 0x80 || decoded[1] !== 0x24) {
    throw new Error("did:key is not a P-256 public key");
  }
  return decompressP256(decoded.subarray(2));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Odd-length hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const v = Number.parseInt(clean.slice(i, i + 2), 16);
    if (Number.isNaN(v)) throw new Error("Invalid hex");
    out[i / 2] = v;
  }
  return out;
}

function subtle(): SubtleCrypto | null {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.subtle ?? null;
}

/* ------------------------------------------------------------------ */
/*  Verification                                                       */
/* ------------------------------------------------------------------ */

/**
 * Verify one signature tuple. Resolves to `unsigned` for a missing tuple,
 * `unsupported` where WebCrypto is unavailable, `invalid` with a reason for
 * anything that fails to check out, and `verified` with the signing did and
 * time otherwise.
 */
export async function verifySignatureTuple(
  signature: string | string[] | null | undefined,
): Promise<VerificationResult> {
  const tuple = parseSignature(signature);
  if (!tuple) return { status: "unsigned" };
  const [timestamp, did, actionHash, prevStateHash, signatureHex] = tuple;
  if (!did || !signatureHex) return { status: "invalid", reason: "incomplete tuple" };

  const sc = subtle();
  if (!sc) return { status: "unsupported", reason: "WebCrypto unavailable" };

  let publicKey: Uint8Array;
  try {
    publicKey = publicKeyFromDidKey(did);
  } catch (e) {
    return { status: "invalid", reason: e instanceof Error ? e.message : "bad did:key" };
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = hexToBytes(signatureHex);
  } catch {
    return { status: "invalid", reason: "signature is not hex" };
  }
  if (sigBytes.length !== 64) {
    return { status: "invalid", reason: `signature is ${sigBytes.length} bytes, expected 64` };
  }

  try {
    const key = await sc.importKey(
      "raw",
      publicKey as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await sc.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes as BufferSource,
      buildSignatureMessage([timestamp, did, actionHash, prevStateHash]) as BufferSource,
    );
    if (!ok) return { status: "invalid", reason: "signature does not match the key" };
    const seconds = Number(timestamp);
    return {
      status: "verified",
      did,
      signedAt: new Date(Number.isFinite(seconds) ? seconds * 1000 : NaN),
    };
  } catch (e) {
    return { status: "invalid", reason: e instanceof Error ? e.message : "verification failed" };
  }
}

/**
 * Recompute `base64(sha256(scope + type + inputJson))` and compare it with
 * the tuple's `actionHash`. `inputJson` must be the input exactly as it was
 * serialised when signed — `JSON.stringify(input)` with the original key
 * order; a projection that stored `JSON.stringify` of the same object
 * satisfies that, a re-ordered copy does not. A mismatch therefore means
 * "cannot confirm", not "tampered" — say so in the UI.
 */
export async function verifyActionHash(args: {
  scope: string;
  type: string;
  inputJson: string;
  actionHash: string;
}): Promise<boolean | null> {
  const sc = subtle();
  if (!sc) return null;
  const payload = new TextEncoder().encode(args.scope + args.type + args.inputJson);
  const digest = new Uint8Array(await sc.digest("SHA-256", payload as BufferSource));
  let binary = "";
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary) === args.actionHash;
}

/** `did:key:zDnaec…dD` → `zDnaec…6dD` for badges. */
export function shortDid(did: string): string {
  const key = did.startsWith("did:key:") ? did.slice(8) : did;
  return key.length > 14 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
}
