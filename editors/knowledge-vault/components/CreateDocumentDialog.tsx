import { useState, useEffect, useRef } from "react";
import { addDocument, setSelectedNode, useSelectedDriveId } from "@powerhousedao/reactor-browser";
import { useFolderMap } from "../hooks/use-drive-init.js";

type CreateDocumentDialogProps = {
  open: boolean;
  documentType: string;
  documentTypeLabel: string;
  onClose: () => void;
};

/**
 * Maps document types to their target folder paths.
 * Documents are placed in structured folders, not drive root.
 */
const DOC_TYPE_FOLDER: Record<string, string> = {
  "bai/knowledge-note": "knowledge/notes",
  "bai/moc": "knowledge",
  "bai/source": "sources",
  "bai/observation": "ops",
  "bai/tension": "ops",
  "bai/health-report": "ops/health",
  "bai/research-claim": "research",
};

export function CreateDocumentDialog({
  open,
  documentType,
  documentTypeLabel,
  onClose,
}: CreateDocumentDialogProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const driveId = useSelectedDriveId();
  const folderMap = useFolderMap();

  useEffect(() => {
    if (open) {
      setName("");
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !driveId || loading) return;
    setLoading(true);
    try {
      const targetFolder = DOC_TYPE_FOLDER[documentType];
      const parentFolderId = targetFolder ? folderMap.get(targetFolder) : undefined;
      const result = await addDocument(driveId, name.trim(), documentType, parentFolderId);
      onClose();
      if (result?.id) {
        setSelectedNode(result.id);
      }
    } catch (err) {
      console.error("[CreateDocument] Failed:", err);
      setLoading(false);
    }
  }

  if (!open) return null;

  const targetFolder = DOC_TYPE_FOLDER[documentType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-[420px] rounded-2xl bg-[#181825] p-6 shadow-2xl ring-1 ring-white/10"
      >
        <h2 className="text-lg font-bold text-gray-100">
          Create {documentTypeLabel}
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          {documentType}
          {targetFolder && (
            <span className="ml-2 text-gray-600">
              &rarr; /{targetFolder}/
            </span>
          )}
        </p>

        <div className="mt-5">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Name your ${documentTypeLabel.toLowerCase()}...`}
            className="w-full rounded-xl border border-white/10 bg-[#1e1e2e] px-4 py-3 text-sm text-gray-200 outline-none placeholder:text-gray-600 focus:border-[#cba6f7]/50 focus:ring-1 focus:ring-[#cba6f7]/20"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-xl bg-[#cba6f7] px-5 py-2.5 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#cba6f7]/80 disabled:opacity-40"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
