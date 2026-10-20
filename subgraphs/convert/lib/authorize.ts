import type { RouteContext } from "@powerhousedao/shared/processors";
import { HttpError } from "./respond.js";

/**
 * Mirrors `subgraphs/http/lib/authorize.ts` rather than importing it — same
 * reason `respond.ts` is mirrored: subgraphs are independently deployable, and
 * reaching across one would let its refactor break another's routes.
 *
 * Needed because `auth: "renown"` is enforced by the *host*, and a host with
 * authentication disabled serves every route anonymously. Conversion is
 * compute — a 238-page book takes 5 m 33 s — so it must not be reachable by
 * an anonymous caller on a deployment that has auth switched off — unless the
 * host *declares* open mode (a desktop app's local engine; see openModeUser).
 */
/**
 * Open mode (spec §7.3 of the desktop app): a desktop host's local engine runs
 * with authentication off and declares `KNOWLEDGE_VAULT_OPEN_MODE=1`; its
 * anonymous caller is then the engine's owner, attributed to the engine's own
 * identity (`KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS`). The declaration is the point:
 * a hosted deployment that merely has auth switched off declares nothing and
 * stays closed.
 */
function openModeUser(ctx: RouteContext): RouteContext["user"] {
  if (ctx.authEnabled) return undefined;
  const declared = /^(1|true|yes|on)$/i.test(
    (process.env.KNOWLEDGE_VAULT_OPEN_MODE ?? "").trim(),
  );
  if (!declared) return undefined;
  const address = process.env.KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS?.trim() || "local";
  return { address, chainId: 0, networkId: "local", appKey: "desktop-knowledge-vault" };
}

export function requireUser(
  ctx: RouteContext,
): NonNullable<RouteContext["user"]> {
  const user = ctx.user ?? openModeUser(ctx);
  if (!user) {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "A verified bearer is required",
    );
  }
  return user;
}
