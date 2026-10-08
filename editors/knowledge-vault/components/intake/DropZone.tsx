import { useRef, useState } from "react";

/**
 * The picker, with a drop target of its own — always present while a batch
 * runs, so file N+1 has an obvious door. The whole vault is a drop target too
 * (`FileDropOverlay`); this box is where the eye goes first.
 *
 * It only hands over `File`s. Checking them against the converter's formats
 * and reading their bytes happen in the batch, so a pick of twenty files shows
 * twenty rows at once instead of waiting for every one to be read.
 */
export function DropZone({
  formats,
  onFiles,
  variant = "compact",
  disabled = false,
}: {
  formats: readonly string[];
  onFiles: (files: File[]) => void;
  variant?: "compact" | "hero";
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function take(list: FileList | null) {
    // Copied before the input is cleared: clearing empties its FileList.
    const files = list ? Array.from(list) : [];
    if (inputRef.current) inputRef.current.value = "";
    if (disabled || files.length === 0) return;
    onFiles(files);
  }

  const hero = variant === "hero";
  return (
    <div style={hero ? { width: "100%" } : { width: 224, flex: "none" }}>
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          // Handled here: the vault-wide drop target leaves a prevented drop alone.
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={`intake-drop flex flex-col items-center justify-center gap-2 rounded-xl text-center ${
          hero ? "px-6 py-10" : "px-3 py-3"
        } ${disabled ? "opacity-50" : ""}`}
        style={{
          border: `1px dashed ${over ? "var(--bai-accent)" : "var(--bai-border)"}`,
          backgroundColor: "var(--bai-surface)",
        }}
      >
        {hero && (
          <span
            className="text-sm"
            style={{ color: "var(--bai-text-secondary)" }}
          >
            Drop files here, or anywhere in the vault
          </span>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={
            hero
              ? "rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              : "rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
          }
          style={
            hero
              ? {
                  backgroundColor: "var(--bai-accent)",
                  color: "var(--bai-accent-text)",
                }
              : {
                  color: "var(--bai-accent)",
                  border:
                    "1px solid color-mix(in srgb, var(--bai-accent) 45%, var(--bai-border))",
                }
          }
        >
          {hero ? "Choose files" : "Add more files"}
        </button>
        <span
          className="text-[10px]"
          style={{ color: "var(--bai-text-faint)" }}
        >
          {hero
            ? `${formats.length > 0 ? `${formats.length} formats, ` : ""}up to 30 MB each. Several at once is fine.`
            : "or drop them anywhere in the vault"}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={formats.map((f) => `.${f}`).join(",")}
          onChange={(e) => take(e.target.files)}
        />
      </div>
      <style>{`
        .intake-drop { transition: border-color 120ms ease; }
        .intake-link:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
