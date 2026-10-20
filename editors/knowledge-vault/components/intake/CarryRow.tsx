import type { CarryOn } from "../../lib/intake-store.js";
import { displayName, formatBadge } from "../../lib/intake-model.js";
import { FileIcon, XIcon } from "./intake-icons.js";
import { ReadingTrack } from "./SectionStrip.js";

const sources = (n: number) => `${n} source${n === 1 ? "" : "s"}`;

/**
 * An add from an earlier visit that the page did not live to finish — the app
 * quit, or the page reloaded part-way — carried on here, in the same place a
 * file being added shows. One line says where it is; a stopped add (the vault
 * refused a source) waits for the person: Try again, or Forget it.
 */
export function CarryRow({
  carry,
  onCarryOn,
  onForget,
  onOpenSources,
}: {
  carry: CarryOn;
  onCarryOn: () => void;
  onForget: () => void;
  onOpenSources?: () => void;
}) {
  const name = displayName(carry.fileName);
  const fraction = carry.total > 0 ? Math.min(1, carry.done / carry.total) : 0;
  const caption =
    carry.status === "done"
      ? `All ${sources(carry.total)} are in the vault, in “${carry.folderName}”.`
      : carry.status === "stopped"
        ? `Stopped at ${carry.done} of ${carry.total}: ${carry.error ?? "the vault did not take a source."}`
        : carry.status === "adding"
          ? `Carrying on where the last visit stopped: ${carry.done} of ${carry.total}…`
          : `Left unfinished last time, at ${carry.done} of ${carry.total}. Carrying on in a moment…`;
  return (
    <li className="ik-row" data-state={carry.status === "done" ? "added" : "converting"} data-done={carry.status === "done" ? "" : undefined}>
      <FileIcon label={formatBadge(carry.fileName)} />
      <div className="ik-row-main">
        <div className="ik-name" title={carry.fileName}>
          {name}
        </div>
        <div className="ik-sub">
          <ReadingTrack bar={{ kind: "measured", fraction }} label={`Adding ${name}`} />
          <span
            className={carry.status === "stopped" ? "ik-cap ik-cap-danger" : carry.status === "done" ? "ik-cap ik-cap-ok" : "ik-cap"}
            title={caption}
          >
            {caption}
          </span>
        </div>
      </div>
      <div className="ik-right">
        {carry.status === "stopped" && (
          <>
            <button type="button" className="ik-btn ik-btn-quiet" onClick={onForget} title="Stop carrying it on. What is in the vault stays.">
              Forget it
            </button>
            <button type="button" className="ik-btn ik-btn-primary" onClick={onCarryOn}>
              Try again
            </button>
          </>
        )}
        {carry.status === "done" && onOpenSources && (
          <button type="button" className="ik-btn ik-btn-quiet" onClick={onOpenSources}>
            Open in Sources
          </button>
        )}
      </div>
      {carry.status === "done" ? (
        <button type="button" className="ik-x" onClick={onForget} aria-label={`Clear ${name}`} title="Clear this line">
          <XIcon />
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}
