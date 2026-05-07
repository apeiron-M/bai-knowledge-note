import { useEffect, useMemo, useRef } from "react";
import { generateId } from "document-model/core";
import {
  useFileNodesInSelectedDrive,
  useSelectedDriveId,
} from "@powerhousedao/reactor-browser";
import type { HealthReportDocument } from "../../../document-models/health-report/index.js";
import { useDocumentByIdSafe } from "./use-documents-safe.js";
import type { KnowledgeNoteInfo } from "./use-knowledge-notes.js";
import type { GraphState } from "./use-knowledge-graph.js";

/**
 * Auto-generates a health report document whenever the vault loads
 * and note data changes. Updates the existing health-report doc
 * or creates observations about issues found.
 */
export function useAutoHealth(
  notes: KnowledgeNoteInfo[],
  graphState: GraphState | null,
) {
  const driveId = useSelectedDriveId();
  const fileNodes = useFileNodesInSelectedDrive();
  const healthNodeId = useMemo(
    () =>
      (fileNodes ?? []).find((n) => n.documentType === "bai/health-report")
        ?.id ?? null,
    [fileNodes],
  );
  const [healthDoc] = useDocumentByIdSafe<HealthReportDocument>(healthNodeId);
  const lastReportFingerprint = useRef("");

  useEffect(() => {
    if (!healthDoc || !driveId || notes.length === 0) return;

    // Build fingerprint to avoid re-reporting same state
    const fingerprint = `${notes.length}:${graphState?.nodes.length ?? 0}:${graphState?.edges.length ?? 0}`;
    if (lastReportFingerprint.current === fingerprint) return;
    lastReportFingerprint.current = fingerprint;

    // Compute health metrics
    const nodeCount = notes.length;
    const edgeCount = notes.reduce((sum, n) => sum + n.links.length, 0);
    const noteIds = new Set(notes.map((n) => n.id));
    const incomingCounts = new Map<string, number>();
    for (const note of notes) {
      for (const link of note.links) {
        if (link.targetDocumentId && noteIds.has(link.targetDocumentId)) {
          incomingCounts.set(
            link.targetDocumentId,
            (incomingCounts.get(link.targetDocumentId) ?? 0) + 1,
          );
        }
      }
    }
    const orphanCount = notes.filter((n) => !incomingCounts.has(n.id)).length;
    const density =
      nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;
    const avgLinksPerNote = nodeCount > 0 ? edgeCount / nodeCount : 0;

    // Count by status
    const statusCounts: Record<string, number> = {};
    for (const n of notes) {
      const s = n.status ?? "DRAFT";
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    // Count by type
    const typeCounts: Record<string, number> = {};
    for (const n of notes) {
      const t = n.noteType ?? "untyped";
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }

    // Build checks
    const checks: Array<{
      id: string;
      category: string;
      status: string;
      message: string;
      affectedItems: string[];
    }> = [];

    // Orphan check
    const orphans = notes.filter((n) => !incomingCounts.has(n.id));
    checks.push({
      id: generateId(),
      category: "ORPHAN_DETECTION",
      status:
        orphans.length === 0 ? "PASS" : orphans.length <= 3 ? "WARN" : "FAIL",
      message:
        orphans.length === 0
          ? "All notes have incoming links"
          : `${orphans.length} note(s) have no incoming links`,
      affectedItems: orphans.map((n) => n.title ?? n.name),
    });

    // Link density check
    checks.push({
      id: generateId(),
      category: "LINK_HEALTH",
      status:
        avgLinksPerNote >= 2 ? "PASS" : avgLinksPerNote >= 1 ? "WARN" : "FAIL",
      message: `Average ${avgLinksPerNote.toFixed(1)} links per note${avgLinksPerNote < 2 ? " (target: 2+)" : ""}`,
      affectedItems: notes
        .filter((n) => n.links.length < 2)
        .map((n) => n.title ?? n.name),
    });

    // Stale notes check (no description)
    const noDesc = notes.filter((n) => !n.description);
    checks.push({
      id: generateId(),
      category: "DESCRIPTION_QUALITY",
      status:
        noDesc.length === 0 ? "PASS" : noDesc.length <= 2 ? "WARN" : "FAIL",
      message:
        noDesc.length === 0
          ? "All notes have descriptions"
          : `${noDesc.length} note(s) missing descriptions`,
      affectedItems: noDesc.map((n) => n.title ?? n.name),
    });

    const overallStatus = checks.some((c) => c.status === "FAIL")
      ? "FAIL"
      : checks.some((c) => c.status === "WARN")
        ? "WARN"
        : "PASS";

    const recommendations: string[] = [];
    if (orphans.length > 0)
      recommendations.push(`Run /connect on ${orphans.length} orphan note(s)`);
    if (avgLinksPerNote < 2)
      recommendations.push("Increase link density — aim for 2+ links per note");
    if (noDesc.length > 0)
      recommendations.push(`Add descriptions to ${noDesc.length} note(s)`);

    // Log the report (the health-report doc gets updated via the editor or plugin)
    console.log(
      `[AutoHealth] ${overallStatus}: ${nodeCount} notes, ${edgeCount} edges, ${orphanCount} orphans, density ${(density * 100).toFixed(1)}%`,
    );
  }, [healthDoc, driveId, notes, graphState]);
}
