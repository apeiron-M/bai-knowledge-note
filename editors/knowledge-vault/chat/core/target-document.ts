/**
 * Which document a chat request acts on (M0): the viewed document from the
 * context frame, except that a request naming exactly one *other* supported
 * document verbatim retargets to it (the card says so). When the request
 * also points at the open document, either one may be the one to change
 * ("link this note to X" changes the open note, "add this to X" changes X),
 * which only the intent settles, so the chat asks which document to change
 * before running the models. A request that refers to another document
 * without its exact title ("the CRDT MOC" for a MOC titled "CRDTs") asks
 * with the top 3 matches, plus the open document. Nothing dispatches
 * without Confirm. The pipeline needs a document type (without one, op
 * accuracy falls to 37–39%, round 9 R3/R4), so with nothing open and
 * nothing named the chat only answers questions.
 *
 * The resolver moved to nl-runtime (core/target-document) in M1, where the
 * create rules, type labels and type nouns are inputs. M2: the tables are
 * the generated manifest's (`chat-manifest/`, from `chat.overrides.ts`), and
 * the old functions bind them.
 */
import {
  type CandidateDoc,
  type ChatRoute,
  createIntent as coreCreateIntent,
  type CreateIntent,
  type CreateTypes,
  documentMentions as coreDocumentMentions,
  type DocumentMention,
  documentTypeName as coreDocumentTypeName,
  mentionedCandidates as coreMentionedCandidates,
  resolveTargetDocument as coreResolveTargetDocument,
  type ResolveTargetInput,
  routeChatTurn as coreRouteChatTurn,
  type TargetResolution,
  type TypeLabels,
  type TypeNouns,
} from "nl-runtime";
import { chatManifest } from "../../../../chat-manifest/index.js";

export {
  type ChatRoute,
  type CreateIntent,
  type DocumentMention,
  mentionsCurrentDocument,
  mentionsTitle,
  namedDocuments,
  PICK_COUNT,
  type ResolveTargetInput,
  type TargetResolution,
} from "nl-runtime";

/** Type nouns that make a phrase refer to a document, with the document
 * types each one can mean (`null`: any). Keys with spaces match word by
 * word, longest first ("map of content"). */
export const TYPE_NOUNS: TypeNouns = chatManifest.typeNouns ?? {};

/** "create a new note about X" → the New dialog for that type. */
export const CREATE_TYPES: CreateTypes = chatManifest.createTypes ?? [];

/** Display names by unprefixed type name. */
export const TYPE_LABELS: TypeLabels = chatManifest.typeLabels;

export function createIntent(utterance: string): CreateIntent | null {
  return coreCreateIntent(utterance, CREATE_TYPES);
}

export function routeChatTurn(
  utterance: string,
  target: TargetResolution,
): ChatRoute {
  return coreRouteChatTurn(utterance, target, {
    createTypes: CREATE_TYPES,
    typeLabels: TYPE_LABELS,
  });
}

export function documentTypeName(docType: string): string {
  return coreDocumentTypeName(docType, TYPE_LABELS);
}

export function resolveTargetDocument(
  i: Omit<ResolveTargetInput, "typeNouns">,
): TargetResolution {
  return coreResolveTargetDocument({ ...i, typeNouns: TYPE_NOUNS });
}

export function documentMentions(utterance: string): DocumentMention[] {
  return coreDocumentMentions(utterance, TYPE_NOUNS);
}

export function mentionedCandidates(
  utterance: string,
  documents: CandidateDoc[],
  opts: { openId?: string; recentIds?: string[] } = {},
): { candidates: CandidateDoc[]; phrase: string } {
  return coreMentionedCandidates(utterance, documents, {
    ...opts,
    typeNouns: TYPE_NOUNS,
  });
}
