/**
 * Goal 1 of the audit: "is anything exposed?"
 *
 * The verdict is the visual anchor and the findings are RANKED, because an
 * unordered list of things-that-might-be-wrong is the same cognitive load as no
 * list. Every finding is computed from live state — none is hardcoded — so this
 * tab cannot claim a problem that is already fixed, or miss one that is not.
 */
import { Card, Hint, SectionHeader, SeverityPill, short } from "./parts.js";
import { AccessRoster } from "./AccessRoster.js";
import type { Grant, Level, Protection } from "./use-auth-api.js";
import { LEVEL_RANK } from "./use-auth-api.js";

type Finding = {
  severity: "critical" | "warning" | "ok";
  title: string;
  detail: string;
  fix: string;
};

const SEVERITY_ORDER = { critical: 0, warning: 1, ok: 2 } as const;

export function buildFindings(
  protection: Protection | null,
  grants: Grant[],
  documentCount: number,
  viewerIsSupremeAdmin: boolean,
): Finding[] {
  const out: Finding[] = [];
  const admins = grants.filter((g) => LEVEL_RANK[g.permission] >= LEVEL_RANK.ADMIN);
  const writers = grants.filter((g) => LEVEL_RANK[g.permission] >= LEVEL_RANK.WRITE);

  if (protection && !protection.protected) {
    out.push({
      severity: "critical",
      title: "This vault is open to anyone who can reach the Switchboard",
      detail:
        `An unprotected document skips the permission check entirely, for reads and writes alike. ` +
        `All ${documentCount || "?"} documents here are readable, editable and deletable without signing in.`,
      fix: "Set DEFAULT_PROTECTION=true on the Switchboard — after granting the people below, or you will lock everyone out.",
    });
  } else if (protection?.protected) {
    out.push({
      severity: "ok",
      title: "The vault is protected",
      detail:
        "Only the addresses granted below, the owner, and any supreme admin in the server's ADMINS list can reach it.",
      fix: "",
    });
  }

  if (protection?.protected && grants.length === 0) {
    out.push({
      severity: "warning",
      title: "No grants exist",
      detail:
        "Nobody can read this vault except addresses in the server's ADMINS list. If that list is empty or its keys are lost, the vault is unreachable.",
      fix: "Grant at least one address READ under People.",
    });
  }

  // A supreme admin from the server's ADMINS list administers the vault
  // perfectly well without a grant, so the absence of an ADMIN row is only a
  // problem when nobody is administering it at all. Reporting it as a warning
  // regardless is what pushes an admin into granting themselves a row they
  // never needed.
  if (admins.length === 0 && protection?.protected) {
    out.push(
      viewerIsSupremeAdmin
        ? {
            severity: "ok",
            title: "Administered from the server's ADMINS list",
            detail:
              "You reach this vault as a supreme admin, which bypasses every check — no grant is needed, and granting yourself one changes nothing about your access.",
            fix: "Optional: give a trusted address ADMIN so access can also be managed by someone without server access.",
          }
        : {
            severity: "warning",
            title: "No administrator grant on the drive",
            detail:
              "Nothing in the vault names an administrator. Access is administrable only through the server's ADMINS environment variable, which cannot be changed from here.",
            fix: "Grant a trusted address ADMIN so access can be managed from this screen.",
          },
    );
  } else if (admins.length === 1) {
    out.push({
      severity: viewerIsSupremeAdmin ? "ok" : "warning",
      title: viewerIsSupremeAdmin
        ? "One administrator grant, plus the server's ADMINS list"
        : "Only one administrator",
      detail: viewerIsSupremeAdmin
        ? `${short(admins[0].userAddress)} holds the only ADMIN grant, and you also administer this vault through the server's ADMINS list — so a lost key is recoverable from the environment.`
        : `${short(admins[0].userAddress)} is the sole ADMIN grant. Losing that key leaves nobody able to grant or revoke, and there is no recovery path through the API.`,
      fix: viewerIsSupremeAdmin
        ? ""
        : "Grant a second trusted address ADMIN.",
    });
  }

  if (writers.length > 0) {
    out.push({
      severity: "ok",
      title: `${writers.length} address${writers.length === 1 ? "" : "es"} can write`,
      detail:
        "Everyone else with access is read-only. Write covers creating, editing and deleting anything in the vault.",
      fix: "",
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function ExposureTab({
  protection,
  grants,
  documentCount,
  driveName,
  myAddress,
  viewerIsSupremeAdmin,
  busy,
  onChangeLevel,
  onRevoke,
}: {
  protection: Protection | null;
  grants: Grant[];
  documentCount: number;
  driveName: string;
  myAddress: string;
  viewerIsSupremeAdmin: boolean;
  busy: boolean;
  onChangeLevel: (address: string, level: Level) => void;
  onRevoke: (address: string) => void;
}) {
  const findings = buildFindings(
    protection,
    grants,
    documentCount,
    viewerIsSupremeAdmin,
  );
  const exposed = protection !== null && !protection.protected;

  return (
    <div className="flex flex-col gap-4">
      {/* The anchor. One thing to look at first, by contrast and scale. */}
      <Card tone={exposed ? "alarm" : protection?.protected ? "ok" : undefined}>
        <p
          className="text-[11px] font-medium uppercase tracking-wide"
          style={{ color: "var(--bai-text-tertiary)" }}
        >
          {driveName}
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {exposed
            ? "⚠ Open to anyone on the network"
            : protection?.protected
              ? "Protected"
              : "Protection state unknown"}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--bai-text-secondary)" }}>
          {documentCount ? `${documentCount} documents · ` : ""}
          {grants.length} grant{grants.length === 1 ? "" : "s"} ·{" "}
          {exposed
            ? "anonymous read, write and delete"
            : "grants and the ADMINS list only"}
        </p>
        {protection?.ownerAddress ? (
          <Hint>
            Owner {short(protection.ownerAddress)} — an implicit administrator,
            separate from the grants list.
          </Hint>
        ) : null}
      </Card>

      <Card>
        <SectionHeader
          title="Everyone with access"
          subtitle="Change a role or remove access without leaving this page."
          right={
            <span
              className="rounded-md px-2 py-1 font-mono text-xs"
              style={{
                backgroundColor: "var(--bai-hover)",
                color: "var(--bai-text-tertiary)",
              }}
            >
              {grants.length} grant{grants.length === 1 ? "" : "s"}
            </span>
          }
        />
        <AccessRoster
          grants={grants}
          ownerAddress={protection?.ownerAddress ?? null}
          myAddress={myAddress}
          viewerIsSupremeAdmin={viewerIsSupremeAdmin}
          busy={busy}
          onChangeLevel={onChangeLevel}
          onRevoke={onRevoke}
        />
      </Card>

      <div>
        <SectionHeader
          title="Findings"
          subtitle="Computed from live state and ordered by severity — nothing here is hardcoded."
        />
        <ul className="flex flex-col gap-2">
          {findings.map((f) => (
            <li
              key={f.title}
              className="rounded-xl border p-4"
              style={{
                borderColor: "var(--bai-border)",
                backgroundColor: "var(--bai-surface)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-snug">{f.title}</p>
                <SeverityPill severity={f.severity} />
              </div>
              <p
                className="mt-1.5 text-xs leading-relaxed"
                style={{ color: "var(--bai-text-tertiary)" }}
              >
                {f.detail}
              </p>
              {f.fix ? (
                <p
                  className="mt-2 flex gap-1.5 text-xs font-medium leading-relaxed"
                  style={{ color: "var(--bai-accent)" }}
                >
                  <span aria-hidden>→</span>
                  <span>{f.fix}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
