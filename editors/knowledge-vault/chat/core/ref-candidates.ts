/**
 * Labeled ref candidates from a document's state, for step 2: which items a
 * ref field may point at, and the label the model sees for each. The labels
 * follow the training data's conventions (`training/gen/ref-scenarios.ts`,
 * `RECIPES[op].paths`): goal description, member name, deliverable title,
 * task target, topic name, link target title, the drive's document titles.
 * `tests/unit/chat-ref-candidates.test.ts` checks every recipe against this.
 *
 * The machinery moved to nl-runtime (core/ref-candidates) in M1, where the
 * tables are inputs. M2: the tables are the generated manifest's
 * (`chat-manifest/`, `npx nl-generate`): targets derived from the reducers,
 * plus what `chat.overrides.ts` adds (labels, the targets the reducers do
 * not show, context kinds, the `bai/project` branch). The old functions
 * bind them.
 */
import {
  type CandidateDoc,
  type ChatDocument,
  type ContextKinds,
  type CrossDocumentHook,
  currentListsFor as coreCurrentListsFor,
  type CurrentList,
  type CurrentListTable,
  driveRefContext as coreDriveRefContext,
  type DriveRefOptions as CoreDriveRefOptions,
  type RefCandidates,
  refCandidatesFor as coreRefCandidatesFor,
  type RefContextItem,
  type RefExtractorTable,
} from "nl-runtime";
import { chatManifest } from "../../../../chat-manifest/index.js";

export {
  type ChatDocument,
  documentTitle,
  type RefCandidate,
  type RefContextItem,
} from "nl-runtime";

type Rec = Record<string, unknown>;

/** Ref paths per op key, as in the training recipes. */
export const REF_EXTRACTORS: RefExtractorTable = chatManifest.refExtractors;

/**
 * X9: semantic fields that name an existing list item by its value (the
 * reducer removes the exact string), offered as choices from state. A path
 * with no items is left out, so the field stays a free span.
 */
export const STATE_CHOICES: RefExtractorTable = chatManifest.stateChoices;

/** Labeled candidates for every ref path of `opKey` (none for other ops). */
export function refCandidatesFor(
  opKey: string,
  state: Rec,
  ctx: RefContextItem[],
): RefCandidates {
  return coreRefCandidatesFor(opKey, state, ctx, {
    refExtractors: REF_EXTRACTORS,
    stateChoices: STATE_CHOICES,
  });
}

/** X9: list fields an op replaces whole, with the current list (state order). */
export const CURRENT_LISTS: CurrentListTable = chatManifest.currentLists;

/** The current lists `opKey` replaces whole (empty ones left out). */
export function currentListsFor(
  opKey: string,
  state: Rec,
): Record<string, CurrentList> {
  return coreCurrentListsFor(opKey, state, CURRENT_LISTS);
}

/** Drive document kinds per document type (`driveRefContext`). */
export const CTX_KIND_BY_TYPE: ContextKinds = chatManifest.contextKinds;

/** The `bai/project` branch: a project's linked plan's goals (`wbs-goal`). */
export const linkedPlanGoals: CrossDocumentHook = (target, opts, bounded) =>
  chatManifest.crossDocument?.(target, opts, bounded) ?? [];

export type DriveRefOptions = Omit<CoreDriveRefOptions, "linked"> & {
  /** A project target's linked plan, loaded by id (its goals). */
  linkedWbs?: ChatDocument;
};

/**
 * The drive's items a ref field may point at, from the target document's
 * point of view: other notes (`note`, `knowledge`), plans (`wbs`), projects
 * (`project`) and, for a project with a linked plan, that plan's goals
 * (`wbs-goal`). At most `cap` per kind plus the items the target's state
 * already refers to.
 */
export function driveRefContext(
  target: ChatDocument,
  documents: CandidateDoc[],
  opts: DriveRefOptions = {},
): RefContextItem[] {
  const { linkedWbs, ...rest } = opts;
  return coreDriveRefContext(
    target,
    documents,
    { contextKinds: CTX_KIND_BY_TYPE, crossDocument: linkedPlanGoals },
    { ...rest, linked: linkedWbs },
  );
}
