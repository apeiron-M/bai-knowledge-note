/**
 * OpenRouter OAuth (PKCE) and key storage, entirely in the browser.
 *
 * OpenRouter is the only provider offering a browser-native flow that mints a
 * key billed to the *user* — see the design spec's provider table. There is
 * no client secret and no backend, so the whole exchange is safe to run
 * client-side. Verified: both endpoints answer preflight with
 * `access-control-allow-origin: *`.
 *
 * The flow is a full-page redirect, so the app remounts on return. The
 * "return intent" (drive + composer draft) is written to sessionStorage before
 * leaving and read exactly once on the way back; `DriveExplorer` uses it to
 * restore the chat view instead of dropping the user on Search.
 */

const AUTH_URL = "https://openrouter.ai/auth";
const TOKEN_URL = "https://openrouter.ai/api/v1/auth/keys";
const KEY_PROBE_URL = "https://openrouter.ai/api/v1/key";

const KEY_STORAGE = "bai-chat-credentials:v1";
const VERIFIER_STORAGE = "bai-chat:pkce-verifier:v1";
const RETURN_STORAGE = "bai-chat:oauth-return:v1";

export interface ReturnIntent {
  driveId: string;
  draft: string;
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 challenge for a verifier (RFC 7636 §4.2). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(digest);
}

function randomVerifier(): string {
  // 64 random bytes → 86 base64url chars, within RFC 7636's 43–128 range.
  return base64Url(crypto.getRandomValues(new Uint8Array(64)));
}

/** Persist where to come back to, then hand the tab to OpenRouter. */
export async function beginOAuth(intent: ReturnIntent): Promise<void> {
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_STORAGE, verifier);
  sessionStorage.setItem(RETURN_STORAGE, JSON.stringify(intent));

  // The callback must be this exact page so the app remounts where it left.
  const callback = `${location.origin}${location.pathname}${location.search}`;
  const url =
    `${AUTH_URL}?callback_url=${encodeURIComponent(callback)}` +
    `&code_challenge=${encodeURIComponent(await pkceChallenge(verifier))}` +
    `&code_challenge_method=S256`;
  location.assign(url);
}

/** Read the post-redirect intent exactly once; subsequent reads are null. */
export function readReturnIntent(): ReturnIntent | null {
  const raw = sessionStorage.getItem(RETURN_STORAGE);
  sessionStorage.removeItem(RETURN_STORAGE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { driveId?: unknown; draft?: unknown };
    if (typeof parsed.driveId !== "string") return null;
    return {
      driveId: parsed.driveId,
      draft: typeof parsed.draft === "string" ? parsed.draft : "",
    };
  } catch {
    return null;
  }
}

function stripCodeFromUrl(): void {
  const url = new URL(location.href);
  url.searchParams.delete("code");
  history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Exchange `?code=` for a key.
 *
 * The code is stripped from the URL whatever the outcome: it is single-use
 * and expires in ten minutes, so leaving it in place would make a reload look
 * like a second, failing attempt.
 */
export async function completeOAuthFromUrl(): Promise<{ key: string } | null> {
  const code = new URL(location.href).searchParams.get("code");
  if (!code) return null;

  const verifier = sessionStorage.getItem(VERIFIER_STORAGE);
  sessionStorage.removeItem(VERIFIER_STORAGE);
  stripCodeFromUrl();
  if (!verifier) return null;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: "S256",
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { key?: unknown };
    if (typeof body.key !== "string" || !body.key) return null;
    storeKey(body.key);
    return { key: body.key };
  } catch {
    return null;
  }
}

export function getStoredKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function storeKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function clearKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

/** Cheap probe so a pasted key fails at paste time, not mid-conversation. */
export async function validateKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(KEY_PROBE_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
