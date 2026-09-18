import { useRef } from "react";
import { LandingStage } from "../chat/LandingStage.js";
import type { IncomingFile } from "../../hooks/use-intake-batch.js";
import { DropZone } from "./DropZone.js";
import { JOURNEY_STEPS } from "./JourneyStrip.js";

const PATH_HINTS = [
  "pick one file or twenty",
  "we read it — seconds for a page, minutes for a book",
  "tick the parts that should be sources",
  "sources in /sources/, queued for extraction",
];

/**
 * The empty Sources view is the landing: the promise, the drop zone, and the
 * four-step path drawn before the first file, so the user knows the whole way
 * before they start. On the chat's `LandingStage`, because two different
 * centrepieces in one app is how a product starts to look assembled.
 */
function scanLine(
  ocrEngine: "tesseract" | "docling" | null | undefined,
): string {
  switch (ocrEngine) {
    case "tesseract":
      return "Scanned PDFs are read too — a few seconds per page — and Tesseract stands in for the ones the built-in reader gets wrong.";
    case "docling":
      return "Scanned PDFs are read too — a few seconds per page. When a file needs a full OCR pass that would take more than about a minute, you are asked first.";
    default:
      return "Scanned PDFs cannot be read on this machine (no OCR models); PDFs with real text are fine.";
  }
}

export function IntakeLanding({
  vaultName,
  formats,
  configured,
  settled,
  ocrEngine,
  onFiles,
}: {
  vaultName: string;
  formats: string[];
  configured: boolean;
  settled: boolean;
  /** From the service's health: `tesseract` fast, `docling` slow, `null` unavailable. */
  ocrEngine?: "tesseract" | "docling" | null;
  onFiles: (files: IncomingFile[]) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <LandingStage
      anchorRef={anchorRef}
      tail={
        <div className="mx-auto mt-6 flex w-full max-w-2xl justify-center gap-2">
          {JOURNEY_STEPS.map((step, i) => (
            <div key={step} className="flex-1 px-2 text-center">
              <i
                className="mx-auto mb-2 block h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    i === 0 ? "var(--bai-accent)" : "var(--bai-text-faint)",
                }}
              />
              <b
                className="block text-xs font-medium"
                style={{ color: "var(--bai-text-secondary)" }}
              >
                {i + 1} · {step}
              </b>
              <span
                className="block text-[11px]"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                {PATH_HINTS[i]}
              </span>
            </div>
          ))}
        </div>
      }
    >
      <div className="flex w-full max-w-2xl flex-col items-center gap-3 text-center">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--bai-text)" }}
        >
          {vaultName} has no sources yet
        </h1>
        <p
          className="max-w-md text-sm"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          Bring in a PDF, a Word file, a web page, a book. The vault converts
          it, shows you the sources it would become, and writes nothing until
          you approve.
        </p>
        <div ref={anchorRef} className="mt-2 w-full">
          {configured ? (
            <DropZone formats={formats} onFiles={onFiles} variant="hero" />
          ) : (
            <div
              className="rounded-xl px-6 py-8 text-sm"
              style={{
                border: "1px dashed var(--bai-border)",
                color: "var(--bai-text-muted)",
              }}
            >
              {settled ? (
                <>
                  Conversion is not available on this vault yet — set{" "}
                  <code>CONVERT_SERVICE_URL</code> (or{" "}
                  <code>CONVERT_SERVICE_AUTOSTART</code>) and restart the
                  Switchboard. You can still paste text with “Paste text”.
                </>
              ) : (
                "Checking what this vault can convert…"
              )}
            </div>
          )}
        </div>
        {configured && (
          <p className="text-[11px]" style={{ color: "var(--bai-text-faint)" }}>
            {scanLine(ocrEngine)}
          </p>
        )}
        <p className="text-[11px]" style={{ color: "var(--bai-text-muted)" }}>
          Keep the tab open while a file converts — the work lives here until
          step 4.
        </p>
      </div>
    </LandingStage>
  );
}
