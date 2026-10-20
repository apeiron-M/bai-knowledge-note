const COLORS: Record<string, string> = {
  PASS: "#2ea44f",
  WARN: "#d29922",
  FAIL: "#cf222e",
  UNKNOWN: "#8b949e",
};

export function badgeSvg(status: string): string {
  const label = status in COLORS ? status : "UNKNOWN";
  const color = COLORS[label];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20" role="img" aria-label="vault health: ${label}"><rect width="120" height="20" rx="3" fill="${color}"/><text x="60" y="14" fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle">vault: ${label}</text></svg>`;
}

export function overallStatusOf(state: unknown): string {
  const global = (state as { global?: Record<string, unknown> } | undefined)
    ?.global;
  const status = global?.overallStatus;
  return typeof status === "string" && status in COLORS ? status : "UNKNOWN";
}