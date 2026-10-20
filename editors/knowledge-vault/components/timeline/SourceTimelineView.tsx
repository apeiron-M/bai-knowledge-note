import { useEffect, useRef, useState } from "react";
import { useMeasuredWidth } from "../../../shared/use-measured.js";
import { useVaultIdentity } from "../../../shared/use-vault-identity.js";
import { useSourceTimeline, type TimelineGraphData } from "../../hooks/use-source-timeline.js";
import { TimelinePage } from "./TimelinePage.js";

export interface SourceTimelineViewProps {
  driveId: string | undefined;
  /** The editor's graph, for the fallback against an older server. */
  graph: TimelineGraphData;
  onAddSources: () => void;
  onPasteText?: () => void;
  onShowInGraph: (additionId: string) => void;
  onOpenSources: (folderId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onSeeNotes?: (title: string, noteIds: string[]) => void;
}

/** "Now" for the view, kept fresh so Today, Yesterday and the live edge move on their own. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function SourceTimelineView(props: SourceTimelineViewProps) {
  const { timeline, isLoading, error, mode } = useSourceTimeline(props.driveId, props.graph);
  const chart = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(chart, timeline !== null && timeline.additions.length > 0);
  const now = useNow(60_000);
  const { address } = useVaultIdentity();
  return (
    <TimelinePage
      timeline={timeline}
      isLoading={isLoading}
      error={error}
      mode={mode}
      now={now}
      chartWidth={Math.floor(width)}
      measureRef={chart}
      me={address ?? null}
      onAddSources={props.onAddSources}
      onPasteText={props.onPasteText}
      onShowInGraph={props.onShowInGraph}
      onOpenSources={props.onOpenSources}
      onOpenDocument={props.onOpenDocument}
      onSeeNotes={props.onSeeNotes}
    />
  );
}
