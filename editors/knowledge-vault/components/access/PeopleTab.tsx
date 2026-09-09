/**
 * Goals 2–4: who has access, grant, revoke — at the drive level, which is where
 * a vault is normally run because grants inherit downward.
 *
 * Search and sort exist from the first version on purpose: `auth-editor` has
 * neither and stops being usable somewhere around fifty rows.
 *
 * Preview-before-apply is the other audit non-negotiable. A grant is shown as
 * "was → will be" for the exact addresses affected, and only then applied, so
 * the answer to "what did I just do?" is on screen before it is true.
 */
import { useMemo, useState } from "react";
import {
  ADDRESS_RE,
  AddressChip,
  Callout,
  Card,
  ConfirmButton,
  EmptyState,
  Field,
  Hint,
  Inset,
  LEVEL_MEANING,
  LevelBadge,
  LevelSelect,
  NO_DENY_NOTE,
  PrimaryButton,
  SearchInput,
  SectionHeader,
  Select,
  short,
  TextInput,
} from "./parts.js";
import { LEVEL_RANK, type Grant, type Level } from "./use-auth-api.js";

type SortKey = "level" | "address" | "added";

export function PeopleTab({
  grants,
  myAddress,
  busy,
  onGrant,
  onRevoke,
}: {
  grants: Grant[];
  myAddress: string;
  busy: boolean;
  onGrant: (addr: string, level: Level) => void;
  onRevoke: (addr: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("level");
  const [address, setAddress] = useState("");
  const [level, setLevel] = useState<Level>("READ");

  const admins = useMemo(
    () => grants.filter((g) => LEVEL_RANK[g.permission] >= LEVEL_RANK.ADMIN),
    [grants],
  );

  /**
   * Lockout prevention. The tables have no such check: revoking the row that
   * carries the acting admin's only administration path succeeds server-side
   * and leaves nobody able to grant, with no recovery through the API. A
   * supreme admin from ADMINS survives it, so this only refuses when the row
   * really is the last way in.
   */
  function lockoutReason(g: Grant): string | undefined {
    const isMine = g.userAddress.toLowerCase() === myAddress.toLowerCase();
    const isLastAdmin =
      LEVEL_RANK[g.permission] >= LEVEL_RANK.ADMIN && admins.length <= 1;
    if (isMine && isLastAdmin) {
      return "This is the only administrator grant, and it is yours. Revoking it would leave nobody able to manage access, and there is no way back through the API. Grant a second administrator first.";
    }
    return undefined;
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? grants.filter(
          (g) =>
            g.userAddress.toLowerCase().includes(q) ||
            g.permission.toLowerCase().includes(q),
        )
      : grants;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "address") return a.userAddress.localeCompare(b.userAddress);
      if (sort === "added") return b.createdAt.localeCompare(a.createdAt);
      return (
        LEVEL_RANK[b.permission] - LEVEL_RANK[a.permission] ||
        a.userAddress.localeCompare(b.userAddress)
      );
    });
    return sorted;
  }, [grants, query, sort]);

  const trimmed = address.trim();
  const valid = ADDRESS_RE.test(trimmed);
  const existing = grants.find(
    (g) => g.userAddress.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="People with access to the vault"
        subtitle={`Granted on the drive, so each row applies to every document in it. ${NO_DENY_NOTE}`}
        right={
          <span
            className="rounded-md px-2 py-1 text-xs font-mono"
            style={{
              backgroundColor: "var(--bai-hover)",
              color: "var(--bai-text-tertiary)",
            }}
          >
            {grants.length} grant{grants.length === 1 ? "" : "s"}
          </span>
        }
      />

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Filter by address or level…"
          />
        </div>
        <Select
          value={sort}
          onChange={setSort}
          ariaLabel="Sort by"
          options={[
            { value: "level", label: "Sort: level" },
            { value: "address", label: "Sort: address" },
            { value: "added", label: "Sort: newest" },
          ]}
        />
      </div>

      {grants.length === 0 ? (
        <EmptyState title="No grants yet">
          <Hint>
            Only addresses in the server&apos;s ADMINS list can reach this
            vault. Grant one below to change that.
          </Hint>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title={`No grant matches “${query}”`} />
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ color: "var(--bai-text-tertiary)" }}>
              <th className="py-1 text-[11px] font-medium uppercase">Address</th>
              <th className="py-1 text-[11px] font-medium uppercase">Level</th>
              <th className="py-1 text-[11px] font-medium uppercase">Granted by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const reason = lockoutReason(g);
              const isMe =
                g.userAddress.toLowerCase() === myAddress.toLowerCase();
              return (
                <tr
                  key={g.userAddress}
                  className="border-t"
                  style={{ borderColor: "var(--bai-border)" }}
                >
                  <td className="py-2.5">
                    <AddressChip address={g.userAddress} you={isMe} />
                  </td>
                  <td className="py-2.5">
                    <LevelBadge level={g.permission} />
                  </td>
                  <td className="py-2.5">
                    <AddressChip address={g.grantedBy} />
                  </td>
                  <td className="py-2.5 text-right">
                    <ConfirmButton
                      label="Revoke"
                      confirmLabel={`Revoke ${short(g.userAddress)}`}
                      onConfirm={() => onRevoke(g.userAddress)}
                      disabled={busy || reason !== undefined}
                      disabledReason={reason}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Card>
        <SectionHeader title="Give someone access" />
        <Inset>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[20rem] flex-1">
            <Field label="Wallet address">
              <TextInput
                value={address}
                onChange={setAddress}
                placeholder="0x…"
                mono
              />
            </Field>
          </div>
          <Field label="Level">
            <LevelSelect value={level} onChange={setLevel} />
          </Field>
          <PrimaryButton
            onClick={() => {
              onGrant(trimmed, level);
              setAddress("");
            }}
            disabled={busy || !valid}
          >
            {busy ? "Working…" : "Grant"}
          </PrimaryButton>
        </div>

        {/* Just-in-time: what this level means, at the moment of choosing it. */}
        <Hint>{LEVEL_MEANING[level]}</Hint>

        {/* Preview before apply. */}
        {trimmed.length > 0 && !valid ? (
          <Callout tone="danger">
            Not an Ethereum address — expected 0x followed by 40 hex characters.
          </Callout>
        ) : valid ? (
          <Callout tone="info">
            {existing
              ? `${short(trimmed)} currently has ${existing.permission} → will have ${level}. Levels replace rather than add.`
              : `${short(trimmed)} has no access → will have ${level} across the whole vault.`}
          </Callout>
        ) : null}
        </Inset>
      </Card>
    </div>
  );
}
