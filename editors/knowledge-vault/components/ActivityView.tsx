import { authHeaders } from "../../shared/authed-fetch.js";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  setSelectedNode,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type OperationRecord = {
  id: string;
  documentId: string;
  operationType: string;
  timestamp: string;
  index: number;
  summary: string | null;
  signerAddress: string | null;
  signerApp: string | null;
  /** did:key of the signing app instance; null when unsigned. */
  signerKey: string | null;
  /** The stored signature tuple, verifiable client-side (see SignerBadge). */
  signature: string | null;
};

type FilterType = "all" | "content" | "links" | "lifecycle" | "topics";

const FILTER_TYPES: Record<FilterType, { label: string; ops: string[] }> = {
  all: { label: "All", ops: [] },
  content: {
    label: "Content",
    ops: ["SET_TITLE", "SET_DESCRIPTION", "SET_CONTENT", "SET_NOTE_TYPE"],
  },
  links: {
    label: "Links",
    ops: ["ADD_RELATIONSHIP", "REMOVE_RELATIONSHIP"],
  },
  lifecycle: {
    label: "Lifecycle",
    ops: [
      "SET_STATUS",
      "SUBMIT_FOR_REVIEW",
      "APPROVE_NOTE",
      "REJECT_NOTE",
      "ARCHIVE_NOTE",
      "RESTORE_NOTE",
    ],
  },
  topics: { label: "Topics", ops: ["ADD_TOPIC", "REMOVE_TOPIC"] },
};

const OP_ICONS: Record<string, string> = {
  SET_TITLE: "T",
  SET_DESCRIPTION: "D",
  SET_CONTENT: "C",
  SET_NOTE_TYPE: "N",
  ADD_RELATIONSHIP: "+L",
  REMOVE_RELATIONSHIP: "-L",
  ADD_TOPIC: "+#",
  REMOVE_TOPIC: "-#",
  SET_STATUS: "S",
  SUBMIT_FOR_REVIEW: "R",
  APPROVE_NOTE: "A",
  REJECT_NOTE: "X",
  ARCHIVE_NOTE: "Z",
  RESTORE_NOTE: "U",
  SET_PROVENANCE: "P",
  SET_METADATA_FIELD: "M",
};

/* ------------------------------------------------------------------ */
/*  GraphQL                                                           */
/* ------------------------------------------------------------------ */

import { resolveKnowledgeGraphEndpoint } from "../hooks/subgraph-endpoint.js";
import { SignerBadge } from "../../shared/signer-badge.js";
import { debounced, onVaultRemoteChange } from "../../shared/vault-live.js";
import { useSignatureVerification } from "../../shared/use-signature-verification.js";
import type { VerificationResult } from "../../shared/verify-signature.js";

const ACTIVITY_QUERY = `
  query Activity($driveId: ID!, $limit: Int) {
    knowledgeGraphActivity(driveId: $driveId, limit: $limit) {
      id documentId operationType timestamp index summary signerAddress signerApp signerKey signature
    }
  }
`;

async function fetchActivity(
  driveId: string,
  limit: number,
): Promise<OperationRecord[]> {
  try {
    const res = await fetch(resolveKnowledgeGraphEndpoint(), {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        query: ACTIVITY_QUERY,
        variables: { driveId, limit },
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { knowledgeGraphActivity: OperationRecord[] };
    };
    return json.data?.knowledgeGraphActivity ?? [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function ActivityView() {
  const driveId = useSelectedDriveId();
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const endpoint = useMemo(() => resolveKnowledgeGraphEndpoint(), []);

  const loadActivity = useCallback(async () => {
    if (!driveId) return;
    setLoading(true);
    const data = await fetchActivity(driveId, 200);
    setOperations(data);
    setLoading(false);
  }, [driveId]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  // Live: any change in this drive lands in the projection a beat later;
  // coalesce a burst of operations into one reload.
  useEffect(() => {
    if (!driveId) return;
    const reload = debounced(() => {
      if (!driveId) return;
      void fetchActivity(driveId, 200).then(setOperations);
    }, 1_500);
    return onVaultRemoteChange((change) => {
      if (change.driveId === driveId) reload();
    });
  }, [driveId]);

  const sigItems = useMemo(
    () => operations.map((op) => ({ id: op.id, signature: op.signature })),
    [operations],
  );
  const verdicts = useSignatureVerification(sigItems);

  const filtered = useMemo(() => {
    if (filter === "all") return operations;
    const allowedOps = FILTER_TYPES[filter].ops;
    return operations.filter((op) => allowedOps.includes(op.operationType));
  }, [operations, filter]);

  // Group by date
  const grouped = useMemo(() => {
    const groups = new Map<string, OperationRecord[]>();
    for (const op of filtered) {
      const date = op.timestamp.slice(0, 10);
      const existing = groups.get(date) ?? [];
      existing.push(op);
      groups.set(date, existing);
    }
    return groups;
  }, [filtered]);

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "var(--bai-text-muted)" }}
      >
        Loading activity...
      </div>
    );
  }

  if (operations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <svg
          className="mb-4 h-12 w-12"
          style={{ color: "var(--bai-text-faint)", opacity: 0.5 }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <p className="text-sm" style={{ color: "var(--bai-text-muted)" }}>
          No activity recorded yet
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--bai-text-faint)" }}>
          Edit notes to start tracking changes
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--bai-text)" }}
          >
            Vault Activity
          </h2>
          <p className="text-xs" style={{ color: "var(--bai-text-muted)" }}>
            {filtered.length} operation{filtered.length !== 1 ? "s" : ""}
            {filter !== "all" ? ` (${FILTER_TYPES[filter].label})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadActivity()}
            className="rounded-md border px-3 py-1.5 text-xs transition-colors"
            style={{
              borderColor: "var(--bai-border)",
              color: "var(--bai-text-muted)",
              backgroundColor: "var(--bai-surface)",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_TYPES) as FilterType[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className="rounded-full px-3 py-1 text-xs transition-colors"
            style={{
              backgroundColor:
                filter === key ? "var(--bai-accent)" : "var(--bai-hover)",
              color: filter === key ? "#fff" : "var(--bai-text-muted)",
            }}
          >
            {FILTER_TYPES[key].label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto">
        {[...grouped.entries()].map(([date, ops]) => (
          <div key={date} className="mb-6">
            <h3
              className="sticky top-0 z-10 mb-2 py-1 text-xs font-semibold uppercase tracking-wider"
              style={{
                color: "var(--bai-text-muted)",
                backgroundColor: "var(--bai-bg)",
              }}
            >
              {formatDate(date)}
            </h3>
            <div className="space-y-1">
              {ops.map((op) => (
                <OperationRow
                  key={op.id}
                  op={op}
                  verdict={verdicts.get(op.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Operation row                                                     */
/* ------------------------------------------------------------------ */

function OperationRow({
  op,
  verdict,
}: {
  op: OperationRecord;
  verdict: VerificationResult | undefined;
}) {
  const icon = OP_ICONS[op.operationType] ?? "?";
  const time = op.timestamp.slice(11, 16);

  return (
    <button
      type="button"
      onClick={() => setSelectedNode(op.documentId)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bai-hover)]"
    >
      {/* Icon */}
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
        style={{
          backgroundColor: opColor(op.operationType) + "20",
          color: opColor(op.operationType),
        }}
      >
        {icon}
      </div>

      {/* Summary */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs" style={{ color: "var(--bai-text)" }}>
          {op.summary ?? op.operationType}
        </p>
        <p
          className="truncate text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {op.documentId.slice(0, 8)}...
        </p>
        {(op.signerAddress || op.signerApp || op.signature) && (
          <div className="mt-0.5">
            <SignerBadge
              signer={{
                address: op.signerAddress,
                app: op.signerApp,
                key: op.signerKey,
              }}
              verdict={verdict}
            />
          </div>
        )}
      </div>

      {/* Time */}
      <span
        className="shrink-0 text-[10px] font-mono"
        style={{ color: "var(--bai-text-faint)" }}
      >
        {time}
      </span>

      {/* Arrow */}
      <svg
        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50"
        style={{ color: "var(--bai-text-muted)" }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function opColor(type: string): string {
  if (type.startsWith("SET_TITLE") || type.startsWith("SET_CONTENT"))
    return "#f59e0b";
  if (
    type === "ADD_RELATIONSHIP" ||
    type === "REMOVE_RELATIONSHIP"
  )
    return "#3b82f6";
  if (type.startsWith("ADD_TOPIC") || type.startsWith("REMOVE_TOPIC"))
    return "#10b981";
  if (
    type === "SUBMIT_FOR_REVIEW" ||
    type === "APPROVE_NOTE" ||
    type === "REJECT_NOTE"
  )
    return "#a855f7";
  if (type === "ARCHIVE_NOTE" || type === "RESTORE_NOTE") return "#6b7280";
  return "#64748b";
}

function formatDate(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
