import type { RawAction } from "../envelope.js";

export interface LintFinding {
  path: string;
  rule: string;
  class: "REACTOR_REJECTS" | "VAULT_CONVENTION";
  message: string;
}

export interface LintOptions {
  allowLiteralEscapes?: boolean;
}

export type ModelRule = (
  action: RawAction,
  index: number,
  state: Record<string, unknown>,
) => LintFinding[];
