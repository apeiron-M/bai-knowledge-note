import { useEffect, useState } from "react";
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
};

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

  useEffect(() => {
    const api = createVaultApi();
    let cancelled = false;
    void api
      .get<ConvertHealth>("/convert/health")
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        setHealth(result);
        setSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    settled,
    /** A backend is configured and answered. */
    configured: health?.configured === true && health.ok,
    /** Its models are present, so PDFs and images convert too. */
    ready: health?.ready === true,
    formats: health?.formats ?? [],
    missing: health?.missing ?? [],
    /**
     * `tesseract`: scans read fast. `docling`: scans read slowly (offered above
     * the budget). `null`: a scan cannot be read here; the landing says what
     * to install.
     */
    ocrEngine: health?.ocrEngine ?? null,
    autoOcrBudgetSeconds: health?.autoOcrBudgetSeconds ?? 60,
  };
}
