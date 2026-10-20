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
  Callout,
  Card,
  EmptyState,
  Field,
  Hint,
  Inset,
  LEVEL_MEANING,
  LevelSelect,
  NO_DENY_NOTE,
  PrimaryButton,
  SearchInput,
  SectionHeader,
  Select,
  short,
  TextInput,
} from "./parts.js";
import { AccessRoster } from "./AccessRoster.js";
import { LEVEL_RANK, type Grant, type Level } from "./use-auth-api.js";

type SortKey = "level" | "address" | "added";

export function PeopleTab({
  grants,
  ownerAddress,
  myAddress,
  viewerIsSupremeAdmin,
  busy,
  onGrant,
  onChangeLevel,
  onRevoke,
}: {
  grants: Grant[];
  ownerAddress: string | null;
  myAddress: string;
  viewerIsSupremeAdmin: boolean;
  busy: boolean;
  onGrant: (addr: string, level: Level) => void;
  onChangeLevel: (addr: string, level: Level) => void;
  onRevoke: (addr: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("level");
  const [address, setAddress] = useState("");
  const [level, setLevel] = useState<Level>("READ");

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

      {rows.length === 0 && grants.length > 0 ? (
        <EmptyState title={`No grant matches “${query}”`} />
      ) : (
        <AccessRoster
          grants={rows}
          ownerAddress={ownerAddress}
          myAddress={myAddress}
          viewerIsSupremeAdmin={viewerIsSupremeAdmin}
          busy={busy}
          onChangeLevel={onChangeLevel}
          onRevoke={onRevoke}
        />
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
