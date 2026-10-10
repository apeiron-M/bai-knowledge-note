import { useEffect, useState } from "react";
import { DEFAULT_MAX_UPLOAD_BYTES } from "../lib/intake-model.js";
import { createVaultApi } from "../lib/vault-api.js";

export type ConvertHealth = {
  configured: boolean;
  ok: boolean;
  ready: boolean;
  backend: string | null;
  formats: string[];
  missing: string[];
  /** Reported by the service: what this machine can do about a scan. */
  ocrEngine?: "tesseract" | "docling" | null;
  autoOcrBudgetSeconds?: number;
  capabilities?: Record<string, unknown>;
  /** This vault's cap for one upload (a vault on this computer allows more); absent from older servers. */
  maxUploadBytes?: number;
  /**
   * How many conversions may run at once, per lane: `models` for the formats
   * in `modelExtensions`, `other` beside it. Absent from an older service,
   * which runs one conversion in total.
   */
  slots?: {
    models: number;
    other: number;
    busyModels: number;
    busyOther: number;
  };
  /** Lower-case extensions, no dot, that convert in the models lane. */
  modelExtensions?: string[];
};

/** One stable empty list, so a consumer's effect does not re-run on every render. */
const NO_EXTENSIONS: readonly string[] = [];

/**
 * What the conversion service can do, read once per mount.
 *
 * The formats drive the picker's `accept` — a hard-coded list would drift from
 * what the service actually reads, and an unconfigured vault should not offer a
 * picker that fails. `GET convert/health` deliberately answers 200 with
 * `configured: false` rather than 503, so the vault is never reported broken.
 */
export function useConvertHealth() {
  const [health, setHealth] = useState<ConvertHealth | null>(null);
  const [settled, setSettled] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const api = createVaultApi();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    // A converter still starting (the desktop app installs it at first launch) answers "not configured"
    // or not at all: ask again for a while, so a vault opened early still reads files once it is ready.
    const check = () => {
      void api
        .get<ConvertHealth>("/convert/health")
        .catch(() => null)
        .then((result) => {
          if (cancelled) return;
          setHealth(result);
          setSettled(true);
          attempts += 1;
          const ready = result?.configured === true && result.ok;
          if (!ready && attempts < 40) timer = setTimeout(check, 3000);
          else setChecking(false);
        });
    };
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return {
    settled,
    /** Still asking again: the converter may yet become ready. */
    checking,
    /** A backend is configured and answered. */
    configured: health?.configured === true && health.ok,
    /** Its models are present, so PDFs and images convert too. */
    ready: health?.ready === true,
    formats: health?.formats ?? [],
    missing: health?.missing ?? [],
    /** The largest file this vault converts. */
    maxUploadBytes: health?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    /**
     * `tesseract`: scans read fast. `docling`: scans read slowly (offered above
     * the budget). `null`: a scan cannot be read here; the landing says what
     * to install.
     */
    ocrEngine: health?.ocrEngine ?? null,
    autoOcrBudgetSeconds: health?.autoOcrBudgetSeconds ?? 60,
    /** The service's lanes; undefined from an older service — the intake then sends one file at a time. */
    slots: health?.slots,
    /** The extensions that convert in the models lane. */
    modelExtensions: health?.modelExtensions ?? NO_EXTENSIONS,
  };
}
