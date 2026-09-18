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
 * an anonymous caller on a deployment that has auth switched off.
 */
export function requireUser(
  ctx: RouteContext,
): NonNullable<RouteContext["user"]> {
  if (!ctx.user) {
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "A verified bearer is required",
    );
  }
  return ctx.user;
}
