import { useRef, useState } from "react";
import { validateFile } from "../../lib/intake-model.js";
import type { IncomingFile } from "../../hooks/use-intake-batch.js";

/**
 * The picker and its drop zone — always present while a batch runs, so file
 * N+1 has somewhere to go.
 *
 * `accept` is built from the server's own `formats` rather than a copy of them,
 * and the size/extension check runs here so a file the service would refuse
 * never costs an upload.
 */
export function DropZone({
  formats,
  onFiles,
  variant = "compact",
  disabled = false,
}: {
  formats: string[];
  onFiles: (files: IncomingFile[]) => void;
  variant?: "compact" | "hero";
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  async function accept(list: FileList | null) {
    if (!list || disabled) return;
    const accepted: IncomingFile[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(list)) {
      const verdict = validateFile(
        { name: file.name, size: file.size },
        formats,
      );
      if (!verdict.ok) {
        rejected.push(`${file.name}: ${verdict.reason}`);
        continue;
      }
      accepted.push({
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        data: new Uint8Array(await file.arrayBuffer()),
      });
    }
    setRefused(rejected);
    if (accepted.length > 0) onFiles(accepted);
    if (inputRef.current) inputRef.current.value = "";
  }

  const hero = variant === "hero";
  return (
    <div style={hero ? { width: "100%" } : { width: 224, flex: "none" }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void accept(e.dataTransfer.files);
        }}
        className={`intake-drop flex flex-col items-center justify-center gap-2 rounded-xl text-center ${
          hero ? "px-6 py-10" : "px-3 py-3"
        } ${disabled ? "opacity-50" : ""}`}
        style={{
          border: `1px dashed ${over ? "var(--bai-accent)" : "var(--bai-border)"}`,
          backgroundColor: "var(--bai-surface)",
        }}
      >
        <span
          className={hero ? "text-sm" : "text-xs"}
          style={{ color: "var(--bai-text-secondary)" }}
        >
          {hero ? "Drop files here" : "Drop more files"}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={
            hero
              ? "rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              : "intake-link text-[11px] font-medium"
          }
          style={
            hero
              ? {
                  backgroundColor: "var(--bai-accent)",
                  color: "var(--bai-accent-text)",
                }
              : { color: "var(--bai-accent)" }
          }
        >
          {hero ? "Choose files" : "or choose"}
        </button>
        <span
          className="text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {formats.length > 0 ? `${formats.length} formats · ` : ""}up to 30 MB
          each
          {hero ? " · several at once is fine" : ""}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={formats.map((f) => `.${f}`).join(",")}
          onChange={(e) => void accept(e.target.files)}
        />
      </div>
      {refused.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {refused.map((line) => (
            <li
              key={line}
              className="text-[11px]"
              style={{ color: "var(--bai-warn)" }}
            >
              {line}
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .intake-drop { transition: border-color 120ms ease; }
        .intake-link:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
