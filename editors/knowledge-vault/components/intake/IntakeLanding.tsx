import { useRef } from "react";
import { formatsSentence } from "../../lib/intake-model.js";
import { LandingStage } from "../chat/LandingStage.js";
import { DropZone } from "./DropZone.js";
import { IntakeStyles } from "./intake-styles.js";

/**
 * The empty Sources view: one promise, one place to drop, one line about what
 * the vault reads. The drop area draws a file becoming sections, so the idea is
 * seen before it is explained. On the chat's `LandingStage`, because two
 * different centrepieces in one app is how a product starts to look assembled.
 */
export function IntakeLanding({
  accept,
  maxUploadBytes,
  configured,
  settled,
  ocrEngine,
  onFiles,
}: {
  /** Extensions the converter reads. */
  accept: readonly string[];
  /** This vault's cap for one file (`convert/health`). */
  maxUploadBytes?: number;
  configured: boolean;
  settled: boolean;
  /** From the service's health: `null` when scans can't be read on this machine. */
  ocrEngine?: "tesseract" | "docling" | null;
  onFiles: (files: File[]) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const formats = formatsSentence(accept);
  return (
    <LandingStage anchorRef={anchorRef}>
      <div className="bai-intake flex w-full max-w-2xl flex-col items-center text-center">
        <IntakeStyles />
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--bai-text)", letterSpacing: "-0.01em" }}
        >
          Add your first sources
        </h1>
        <p
          className="mt-2.5 max-w-md text-sm leading-relaxed"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          Bring in reports, papers, books and web pages. Each file is read and
          split at its chapters, and you choose what goes into the vault.
        </p>
        <div ref={anchorRef} className="mt-6 w-full">
          {configured ? (
            <DropZone
              accept={accept}
              maxUploadBytes={maxUploadBytes}
              onFiles={onFiles}
              variant="hero"
            />
          ) : (
            <div
              className="rounded-2xl px-6 py-8 text-sm"
              style={{
                border: "1.5px dashed var(--bai-border)",
                color: "var(--bai-text-tertiary)",
              }}
            >
              {settled ? (
                <>
                  This vault can't read files yet. Set{" "}
                  <code>CONVERT_SERVICE_URL</code> (or{" "}
                  <code>CONVERT_SERVICE_AUTOSTART</code>) and restart the
                  Switchboard. You can still use Paste text.
                </>
              ) : (
                "Checking what this vault can read…"
              )}
            </div>
          )}
        </div>
        {configured && formats && (
          <p
            className="mt-3.5 text-[12.5px]"
            style={{ color: "var(--bai-text-tertiary)" }}
          >
            {formats}.
            {ocrEngine === null &&
              " Scans can't be read on this computer; PDFs with real text are fine."}
          </p>
        )}
      </div>
    </LandingStage>
  );
}
