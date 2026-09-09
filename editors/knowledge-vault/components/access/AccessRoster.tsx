/**
 * Everyone who can reach the vault, with an admin's two quick actions: change
 * a role, or remove access.
 *
 * ## The roster is knowably incomplete, and says so
 *
 * Three kinds of principal can reach a protected document, and only two are
 * queryable:
 *
 *  - **Grants** — from `documentAccess`. Listed.
 *  - **The owner** — from `documentProtection`. Listed, and marked as an
 *    implicit administrator, because it is not a grant and cannot be revoked
 *    like one; it is transferred.
 *  - **Supreme admins** — the server's `ADMINS` environment variable. The auth
 *    subgraph exposes no query for these, so they *cannot* be enumerated. A
 *    roster that quietly omitted them would tell an admin they had removed
 *    everyone's access when they had not, so the omission is stated.
 *
 * One supreme admin can be inferred: if the viewer holds no grant and is not
 * the owner, yet `documentAccess` answered (which requires canManage, i.e.
 * supreme admin OR owner OR an ADMIN grant), then they are on that list.
 *
 * ## Why a role change is two clicks
 *
 * Raising a level is harmless; lowering it silently removes capability from
 * someone who had it. Rather than branch on direction, the change is always
 * previewed as "READ → ADMIN" and applied on confirm — the audit's
 * preview-before-apply, at the cost of one click.
 */
import { useState } from "react";
import {
  AddressChip,
  Callout,
  ConfirmButton,
  EmptyState,
  GhostButton,
  Hint,
  LevelBadge,
  LevelSelect,
  Row,
  short,
} from "./parts.js";
import { LEVEL_RANK, type Grant, type Level } from "./use-auth-api.js";

export function lockoutReason(
  g: Grant,
  grants: Grant[],
  myAddress: string,
): string | undefined {
  const admins = grants.filter(
    (x) => LEVEL_RANK[x.permission] >= LEVEL_RANK.ADMIN,
  );
  const isMine = g.userAddress.toLowerCase() === myAddress.toLowerCase();
  const isLastAdmin =
    LEVEL_RANK[g.permission] >= LEVEL_RANK.ADMIN && admins.length <= 1;
  if (isMine && isLastAdmin) {
    return "This is the only administrator grant, and it is yours. Removing or lowering it would leave nobody able to manage access here, and there is no way back through the API. Grant a second administrator first.";
  }
  return undefined;
}

export function AccessRoster({
  grants,
  ownerAddress,
  myAddress,
  viewerIsSupremeAdmin,
  busy,
  onChangeLevel,
  onRevoke,
}: {
  grants: Grant[];
  ownerAddress: string | null;
  myAddress: string;
  viewerIsSupremeAdmin: boolean;
  busy: boolean;
  onChangeLevel: (address: string, level: Level) => void;
  onRevoke: (address: string) => void;
}) {
  const sorted = [...grants].sort(
    (a, b) =>
      LEVEL_RANK[b.permission] - LEVEL_RANK[a.permission] ||
      a.userAddress.localeCompare(b.userAddress),
  );

  const total =
    grants.length + (ownerAddress ? 1 : 0) + (viewerIsSupremeAdmin ? 1 : 0);

  return (
    <div>
      {total === 0 ? (
        <EmptyState title="Nobody is listed">
          <Hint>
            No grants and no owner. Only addresses in the server&apos;s ADMINS
            list can reach this vault, and those cannot be listed here.
          </Hint>
        </EmptyState>
      ) : (
        <div>
          {viewerIsSupremeAdmin ? (
            <Row>
              <span className="flex-1">
                <AddressChip address={myAddress} you />
              </span>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                style={{
                  color: "var(--bai-accent)",
                  backgroundColor: "var(--bai-accent-soft)",
                }}
                title="From the server's ADMINS environment variable. Bypasses every check."
              >
                SERVER ADMIN
              </span>
              <span className="w-40 text-right text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
                set in the environment
              </span>
            </Row>
          ) : null}

          {ownerAddress ? (
            <Row>
              <span className="flex-1">
                <AddressChip
                  address={ownerAddress}
                  you={ownerAddress.toLowerCase() === myAddress.toLowerCase()}
                />
              </span>
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                style={{
                  color: "var(--bai-ok)",
                  backgroundColor: "var(--bai-ok-soft)",
                }}
                title="An owner is an implicit administrator. It is transferred rather than revoked."
              >
                OWNER
              </span>
              <span className="w-40 text-right text-[10px]" style={{ color: "var(--bai-text-muted)" }}>
                transfer under Documents
              </span>
            </Row>
          ) : null}

          {sorted.map((g) => (
            <GrantRow
              key={g.userAddress}
              grant={g}
              grants={grants}
              myAddress={myAddress}
              busy={busy}
              onChangeLevel={onChangeLevel}
              onRevoke={onRevoke}
            />
          ))}
        </div>
      )}

      <Hint>
        Supreme admins from the server&apos;s <code>ADMINS</code> variable bypass
        every check and cannot be listed here — the API exposes no query for
        them. Check the Switchboard&apos;s environment to see that list.
      </Hint>
    </div>
  );
}

function GrantRow({
  grant,
  grants,
  myAddress,
  busy,
  onChangeLevel,
  onRevoke,
}: {
  grant: Grant;
  grants: Grant[];
  myAddress: string;
  busy: boolean;
  onChangeLevel: (address: string, level: Level) => void;
  onRevoke: (address: string) => void;
}) {
  const [pending, setPending] = useState<Level | null>(null);
  const reason = lockoutReason(grant, grants, myAddress);
  const isMe = grant.userAddress.toLowerCase() === myAddress.toLowerCase();

  return (
    <>
      <Row>
        <span className="flex-1">
          <AddressChip address={grant.userAddress} you={isMe} />
        </span>

        {pending === null ? (
          <LevelBadge level={grant.permission} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10px]">
            <LevelBadge level={grant.permission} />
            <span aria-hidden style={{ color: "var(--bai-text-muted)" }}>→</span>
            <LevelBadge level={pending} />
          </span>
        )}

        <span className="flex w-40 items-center justify-end gap-2">
          {reason ? null : (
            <LevelSelect
              value={pending ?? grant.permission}
              onChange={(l) => setPending(l === grant.permission ? null : l)}
            />
          )}
          {pending !== null ? (
            <GhostButton
              disabled={busy}
              onClick={() => {
                onChangeLevel(grant.userAddress, pending);
                setPending(null);
              }}
            >
              Apply
            </GhostButton>
          ) : (
            <ConfirmButton
              label="Remove"
              confirmLabel={`Remove ${short(grant.userAddress)}`}
              onConfirm={() => onRevoke(grant.userAddress)}
              disabled={busy || reason !== undefined}
              disabledReason={reason}
            />
          )}
        </span>
      </Row>
      {pending !== null ? (
        <Callout tone={LEVEL_RANK[pending] < LEVEL_RANK[grant.permission] ? "warn" : "info"}>
          {LEVEL_RANK[pending] < LEVEL_RANK[grant.permission]
            ? `Lowering ${short(grant.userAddress)} from ${grant.permission} to ${pending} removes capability they have today.`
            : `${short(grant.userAddress)} will go from ${grant.permission} to ${pending} across the whole vault.`}
        </Callout>
      ) : null}
    </>
  );
}
