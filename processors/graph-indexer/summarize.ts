/**
 * One human phrase per operation — the vocabulary the vault speaks about its
 * own changes.
 *
 * Written for the graph index's `graph_operations.summary` (what the Activity
 * view renders), and read by the chat's `document_history` tool so a question
 * about who changed what is answered in the same words the UI uses. Kept in
 * its own module because the chat runs in the browser: importing the
 * processor for one pure function would pull kysely and the embedder into
 * the bundle.
 *
 * An action this does not know falls back to its type, which is already
 * readable (`INGEST_SOURCE`, `ADD_FILE`), so every document type gets a
 * sensible line without listing every model's actions here.
 */

export function summarizeOperation(
  type: string,
  input: Record<string, unknown>,
): string {
  switch (type) {
    case "SET_TITLE":
      return `Title changed to "${truncate(input.title)}"`;
    case "SET_DESCRIPTION":
      return `Description updated`;
    case "SET_CONTENT": {
      const len = typeof input.content === "string" ? input.content.length : 0;
      return `Content updated (${len} chars)`;
    }
    case "SET_NOTE_TYPE":
      return `Type set to ${String(input.noteType)}`;
    case "SET_STATUS":
      return `Status changed to ${String(input.status)}`;
    case "ADD_LINK":
      return `Linked to "${truncate(input.targetTitle)}" (${s(input.linkType, "RELATES_TO")})`;
    case "REMOVE_LINK":
      return `Removed link ${s(input.id)}`;
    case "UPDATE_LINK_TYPE":
      return `Link type changed to ${s(input.linkType)}`;
    case "ADD_TOPIC":
      return `Added topic #${s(input.name)}`;
    case "REMOVE_TOPIC":
      return `Removed topic`;
    case "SET_PROVENANCE":
      return `Provenance set: ${s(input.author, "unknown")}, ${s(input.sourceOrigin)}`;
    case "SUBMIT_FOR_REVIEW":
      return `Submitted for review`;
    case "APPROVE_NOTE":
      return `Approved by ${s(input.actor, "unknown")}`;
    case "REJECT_NOTE":
      return `Rejected: ${truncate(input.comment)}`;
    case "ARCHIVE_NOTE":
      return `Archived`;
    case "RESTORE_NOTE":
      return `Restored from archive`;
    case "SET_METADATA_FIELD":
      return `Metadata: ${String(input.field)} = ${truncate(input.value)}`;
    case "CREATE_TENSION":
      return `Tension opened: "${truncate(input.title)}"`;
    case "RESOLVE_TENSION":
      return `Tension resolved: ${truncate(input.resolution)}`;
    case "DISSOLVE_TENSION":
      return `Tension dissolved: ${truncate(input.resolution)}`;
    case "ADD_INVOLVED_REF":
      return `Tension now involves ${s(input.ref)}`;
    case "CREATE_OBSERVATION":
      return `Observation recorded (${s(input.category)}): "${truncate(input.title)}"`;
    case "PROMOTE_OBSERVATION":
      return `Observation promoted to ${s(input.promotedTo)}`;
    case "IMPLEMENT_OBSERVATION":
      return `Observation implemented`;
    case "ARCHIVE_OBSERVATION":
      return `Observation archived`;
    case "CREATE_CLAIM":
      return `Claim created: "${truncate(input.title)}"`;
    case "UPDATE_CLAIM_CONTENT":
      return `Claim content updated`;
    case "CREATE_MOC":
      return `MoC created: "${truncate(input.title)}"`;
    case "UPDATE_ORIENTATION":
      return `Orientation updated`;
    case "ADD_TENSION":
      return `Tension noted on map: ${truncate(input.description)}`;
    case "ADD_OPEN_QUESTION":
      return `Open question: ${truncate(input.question)}`;
    // Scope of work
    case "EDIT_SCOPE_OF_WORK":
      return input.status
        ? `Scope of work ${s(input.status)}`
        : `Scope of work edited`;
    case "ADD_PROJECT":
      return `Project added: ${s(input.code)} "${truncate(input.title)}"`;
    case "UPDATE_PROJECT":
      return `Project updated`;
    case "ADD_DELIVERABLE":
    case "ADD_PROJECT_DELIVERABLE":
    case "ADD_MILESTONE_DELIVERABLE":
      return `Deliverable added: "${truncate(input.title)}"`;
    case "EDIT_DELIVERABLE":
      return input.status
        ? `Deliverable ${s(input.status)}`
        : `Deliverable edited`;
    case "SET_DELIVERABLE_PROGRESS":
      return `Deliverable progress updated`;
    case "ADD_ROADMAP":
      return `Roadmap added: "${truncate(input.title)}"`;
    case "ADD_MILESTONE":
      return `Milestone added: ${s(input.sequenceCode)} "${truncate(input.title)}"`;
    case "LINK_PROJECT_WBS":
      return input.wbsRef
        ? `Work breakdown linked: ${s(input.wbsRef)}`
        : `Work breakdown unlinked`;
    case "ADD_PROJECT_KNOWLEDGE_REF":
      return `Project cites ${s(input.ref)}`;
    case "REMOVE_PROJECT_KNOWLEDGE_REF":
      return `Project no longer cites ${s(input.ref)}`;
    case "LINK_DELIVERABLE_GOAL":
      return input.goalRef
        ? `Deliverable linked to goal ${s(input.goalRef)}`
        : `Deliverable unlinked from its goal`;
    // Work breakdown
    case "CREATE_GOAL":
      return `Goal created: "${truncate(input.description)}"`;
    case "SET_GOAL_STATUS":
      return `Goal ${s(input.status)}${input.blockReason ? `: ${truncate(input.blockReason)}` : ""}`;
    case "ASSIGN_GOAL":
      return `Goal assigned to ${s(input.assignee, "nobody")}`;
    case "ADD_NOTE":
      return `Note added to goal: ${truncate(input.note)}`;
    case "SET_SOW_PROJECT_REF":
      return input.sowRef
        ? `Linked to scope of work ${s(input.sowRef)}`
        : `Unlinked from its scope of work`;
    default:
      return type;
  }
}

/** Safely stringify an unknown value with optional fallback */
export function s(val: unknown, fallback = ""): string {
  if (val == null) return fallback;
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return fallback;
}

export function truncate(val: unknown, max = 60): string {
  const str = s(val);
  return str.length > max ? str.slice(0, max) + "..." : str;
}
