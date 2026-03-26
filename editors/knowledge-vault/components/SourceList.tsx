import { useMemo } from "react";
import {
  setSelectedNode,
  useDocumentsInSelectedDrive,
  showCreateDocumentModal,
} from "@powerhousedao/reactor-browser";

const STATUS_COLORS: Record<string, string> = {
  INBOX: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  EXTRACTING: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  EXTRACTED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export function SourceList() {
  const documents = useDocumentsInSelectedDrive();

  const sources = useMemo(() => {
    return (documents ?? [])
      .filter((d) => d.header.documentType === "bai/source")
      .map((d) => {
        const state = (d.state as unknown as { global: Record<string, unknown> }).global;
        return {
          id: d.header.id,
          name: d.header.name,
          title: (state.title as string) ?? d.header.name,
          sourceType: (state.sourceType as string) ?? null,
          status: (state.status as string) ?? "INBOX",
          claimCount: ((state.extractedClaims as string[]) ?? []).length,
          createdBy: (state.createdBy as string) ?? null,
        };
      });
  }, [documents]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof sources> = { INBOX: [], EXTRACTING: [], EXTRACTED: [], ARCHIVED: [] };
    for (const s of sources) {
      const bucket = groups[s.status] ?? groups.INBOX;
      bucket.push(s);
    }
    return groups;
  }, [sources]);

  if (sources.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-500">No sources yet</p>
          <p className="mt-1 text-sm text-gray-600">Ingest source material to start the extraction pipeline</p>
          <button type="button" onClick={() => showCreateDocumentModal("bai/source")}
            className="mt-4 rounded-lg bg-[#cba6f7] px-4 py-2 text-sm font-medium text-[#1e1e2e] hover:bg-[#cba6f7]/80">
            Ingest Source
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {(["INBOX", "EXTRACTING", "EXTRACTED", "ARCHIVED"] as const).map((status) => {
        const items = grouped[status];
        if (items.length === 0) return null;
        return (
          <div key={status}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLORS[status]?.split(" ")[0]}`} />
              {status.replace("_", " ")} ({items.length})
            </h3>
            <div className="space-y-1">
              {items.map((source) => (
                <button key={source.id} type="button" onClick={() => setSelectedNode(source.id)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-white/5 bg-[#1e1e2e] px-4 py-3 text-left hover:border-[#cba6f7]/30">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-300 group-hover:text-[#cba6f7]">{source.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {source.sourceType && (
                        <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-gray-500">{source.sourceType}</span>
                      )}
                      {source.createdBy && <span className="text-[10px] text-gray-600">by {source.createdBy}</span>}
                    </div>
                  </div>
                  {source.claimCount > 0 && (
                    <span className="text-[10px] text-gray-600">{source.claimCount} claims</span>
                  )}
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[source.status]}`}>
                    {source.status}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
