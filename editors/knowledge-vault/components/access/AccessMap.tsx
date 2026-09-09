/**
 * Who has access to what, across the whole vault — the answer you want before
 * you know which document to ask about.
 *
 * Two groupings because admins arrive with two different questions, and
 * neither is a subset of the other: "what can this person reach?" (by person)
 * and "who can reach this document?" (by document). The audit's wayfinding
 * finding applies — the vault-wide answer must exist before the per-document
 * one is useful, or the only way to find a grant is to already know where it
 * is.
 *
 * Drive-level grants are shown as their own group rather than repeated against
 * 1,500 documents, because that is what they are: one row that reaches
 * everything by inheritance.
 */
import { useMemo, useState } from "react";
import {
  AddressChip,
  Callout,
  Hint,
  LevelBadge,
  Row,
  SearchInput,
  SectionHeader,
  Select,
} from "./parts.js";
import { LEVEL_RANK, type DocumentGrant, type Grant, type ScanState } from "./use-auth-api.js";

type GroupBy = "person" | "document";

export function AccessMap({
  driveGrants,
  scan,
}: {
  driveGrants: Grant[];
  scan: ScanState | null;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("person");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = scan?.rows ?? [];
    if (!q) return all;
    return all.filter(
      (r) =>
        r.userAddress.toLowerCase().includes(q) ||
        r.documentName.toLowerCase().includes(q) ||
        (r.documentType ?? "").toLowerCase().includes(q),
    );
  }, [scan, query]);

  const byPerson = useMemo(() => {
    const map = new Map<string, DocumentGrant[]>();
    for (const r of rows) {
      const key = r.userAddress.toLowerCase();
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  const byDocument = useMemo(() => {
    const map = new Map<string, DocumentGrant[]>();
    for (const r of rows) {
      const list = map.get(r.documentId);
      if (list) list.push(r);
      else map.set(r.documentId, [r]);
    }
    return [...map.entries()].sort((a, b) =>
      a[1][0].documentName.localeCompare(b[1][0].documentName),
    );
  }, [rows]);

  const scanning = scan !== null && !scan.done;
  const pct = scan ? (scan.scanned / Math.max(scan.total, 1)) * 100 : 0;

  return (
    <div>
      <SectionHeader
        title="Who has access to what"
        subtitle="Drive-level grants reach every document by inheritance. Below them, grants set on individual documents."
        right={
          <Select
            value={groupBy}
            onChange={setGroupBy}
            ariaLabel="Group by"
            options={[
              { value: "person", label: "Group: by person" },
              { value: "document", label: "Group: by document" },
            ]}
          />
        }
      />

      {/* Drive-level: one row that reaches everything. */}
      <div className="mb-3">
        <Hint>Whole vault — inherited by all documents</Hint>
        {driveGrants.length === 0 ? (
          <Hint>No drive-level grants.</Hint>
        ) : (
          [...driveGrants]
            .sort((a, b) => LEVEL_RANK[b.permission] - LEVEL_RANK[a.permission])
            .map((g) => (
              <Row key={g.userAddress}>
                <span className="flex-1">
                  <AddressChip address={g.userAddress} />
                </span>
                <LevelBadge level={g.permission} />
                <span
                  className="w-48 text-right text-[10px]"
                  style={{ color: "var(--bai-text-muted)" }}
                >
                  every document
                </span>
              </Row>
            ))
        )}
      </div>

      {scanning ? (
        <div className="mb-3">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: "var(--bai-hover)" }}
          >
            <div
              className="h-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: "var(--bai-accent)" }}
            />
          </div>
          <Hint>
            Checking documents for their own grants — {scan.scanned} of{" "}
            {scan.total}. There is no bulk query, so each document is asked
            individually; results appear as they arrive.
          </Hint>
        </div>
      ) : null}

      {scan === null ? (
        <Hint>Waiting for the drive tree before scanning documents.</Hint>
      ) : (
        <>
          <div className="mb-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Filter by address, document name or type…"
            />
          </div>

          {scan.rows.length === 0 ? (
            <Callout tone="ok">
              {scan.done
                ? "No document carries its own grants — all access comes from the drive-level rows above. That is the simplest arrangement to reason about."
                : "None found yet."}
            </Callout>
          ) : rows.length === 0 ? (
            <Hint>Nothing matches “{query}”.</Hint>
          ) : groupBy === "person" ? (
            <div className="flex flex-col gap-3">
              {byPerson.map(([key, list]) => (
                <div key={key}>
                  <div className="flex items-center gap-2">
                    <AddressChip address={list[0].userAddress} />
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--bai-text-muted)" }}
                    >
                      {list.length} document{list.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {list
                    .sort((a, b) => a.documentName.localeCompare(b.documentName))
                    .map((r) => (
                      <Row key={`${r.documentId}-${r.userAddress}`}>
                        <span className="flex-1 truncate text-xs">
                          {r.documentName}
                          <span
                            className="ml-2 text-[10px]"
                            style={{ color: "var(--bai-text-faint)" }}
                          >
                            {(r.documentType ?? "").replace(/^bai\//, "")}
                          </span>
                        </span>
                        <LevelBadge level={r.permission} />
                      </Row>
                    ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {byDocument.map(([docId, list]) => (
                <div key={docId}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium">
                      {list[0].documentName}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--bai-text-faint)" }}
                    >
                      {(list[0].documentType ?? "").replace(/^bai\//, "")}
                    </span>
                  </div>
                  {list.map((r) => (
                    <Row key={r.userAddress}>
                      <span className="flex-1">
                        <AddressChip address={r.userAddress} />
                      </span>
                      <LevelBadge level={r.permission} />
                    </Row>
                  ))}
                </div>
              ))}
            </div>
          )}

          {scan.done && scan.refused > 0 ? (
            <Callout tone="warn">
              {scan.refused} document{scan.refused === 1 ? "" : "s"} refused the
              query and still exist, so you are not an administrator of them and
              their own grants are not visible here.
            </Callout>
          ) : null}
        </>
      )}
    </div>
  );
}
