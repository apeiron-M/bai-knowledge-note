export type Maybe<T> = T | null | undefined;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Address: { input: `${string}:0x${string}`; output: `${string}:0x${string}` };
  Amount: {
    input: { unit?: string; value?: number };
    output: { unit?: string; value?: number };
  };
  Amount_Crypto: {
    input: { unit: string; value: string };
    output: { unit: string; value: string };
  };
  Amount_Currency: {
    input: { unit: string; value: string };
    output: { unit: string; value: string };
  };
  Amount_Fiat: {
    input: { unit: string; value: number };
    output: { unit: string; value: number };
  };
  Amount_Money: { input: number; output: number };
  Amount_Percentage: { input: number; output: number };
  Amount_Tokens: { input: number; output: number };
  Attachment: { input: string; output: string };
  Currency: { input: string; output: string };
  Date: { input: string; output: string };
  DateTime: { input: string; output: string };
  EmailAddress: { input: string; output: string };
  EthereumAddress: { input: string; output: string };
  OID: { input: string; output: string };
  OLabel: { input: string; output: string };
  PHID: { input: string; output: string };
  URL: { input: string; output: string };
  Unknown: { input: unknown; output: unknown };
  Upload: { input: File; output: File };
};

export type AddLinkInput = {
  id: Scalars["OID"]["input"];
  linkType: LinkType;
  targetDocumentId: Scalars["String"]["input"];
  targetTitle?: InputMaybe<Scalars["String"]["input"]>;
};

export type AddTopicInput = {
  id: Scalars["OID"]["input"];
  name: Scalars["String"]["input"];
  topicDocumentId?: InputMaybe<Scalars["String"]["input"]>;
};

export type ApproveNoteInput = {
  actor: Scalars["String"]["input"];
  comment?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  timestamp: Scalars["DateTime"]["input"];
};

export type ArchiveNoteInput = {
  actor: Scalars["String"]["input"];
  comment: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  timestamp: Scalars["DateTime"]["input"];
};

export type KnowledgeNoteLocalState = {
  lastViewedAt: Maybe<Scalars["DateTime"]["output"]>;
  personalTags: Array<PersonalTag>;
};

export type KnowledgeNoteState = {
  alternatives: Array<Scalars["String"]["output"]>;
  cardinality: Maybe<Scalars["String"]["output"]>;
  computes: Maybe<Scalars["String"]["output"]>;
  confidence: Maybe<Scalars["String"]["output"]>;
  consequences: Array<Scalars["String"]["output"]>;
  consumedBy: Array<Scalars["String"]["output"]>;
  content: Maybe<Scalars["String"]["output"]>;
  context: Maybe<Scalars["String"]["output"]>;
  correctPattern: Maybe<Scalars["String"]["output"]>;
  decisionStatus: Maybe<Scalars["String"]["output"]>;
  description: Maybe<Scalars["String"]["output"]>;
  dispatchTargets: Array<Scalars["String"]["output"]>;
  editor: Maybe<Scalars["String"]["output"]>;
  errorMessage: Maybe<Scalars["String"]["output"]>;
  filePath: Maybe<Scalars["String"]["output"]>;
  hooksUsed: Array<Scalars["String"]["output"]>;
  inputs: Array<Scalars["String"]["output"]>;
  lifecycleEvents: Array<LifecycleEvent>;
  links: Array<NoteLink>;
  model: Maybe<Scalars["String"]["output"]>;
  modelId: Maybe<Scalars["String"]["output"]>;
  models: Array<Scalars["String"]["output"]>;
  modules: Array<Scalars["String"]["output"]>;
  noteType: Maybe<Scalars["String"]["output"]>;
  outputs: Array<Scalars["String"]["output"]>;
  provenance: Maybe<Provenance>;
  relationType: Maybe<Scalars["String"]["output"]>;
  rootCause: Maybe<Scalars["String"]["output"]>;
  scope: Maybe<Scalars["String"]["output"]>;
  severity: Maybe<Scalars["String"]["output"]>;
  sourceType: Maybe<Scalars["String"]["output"]>;
  status: Maybe<NoteStatus>;
  targetType: Maybe<Scalars["String"]["output"]>;
  title: Maybe<Scalars["String"]["output"]>;
  topics: Array<Topic>;
  version: Maybe<Scalars["String"]["output"]>;
};

export type LifecycleEvent = {
  actor: Maybe<Scalars["String"]["output"]>;
  comment: Maybe<Scalars["String"]["output"]>;
  fromStatus: Maybe<NoteStatus>;
  id: Scalars["OID"]["output"];
  timestamp: Maybe<Scalars["DateTime"]["output"]>;
  toStatus: Maybe<NoteStatus>;
};

export type LinkType =
  | "BUILDS_ON"
  | "CONTRADICTS"
  | "DERIVED_FROM"
  | "RELATES_TO"
  | "SUPERSEDES";

export type NoteLink = {
  id: Scalars["OID"]["output"];
  linkType: Maybe<LinkType>;
  targetDocumentId: Maybe<Scalars["String"]["output"]>;
  targetTitle: Maybe<Scalars["String"]["output"]>;
};

export type NoteStatus = "ARCHIVED" | "CANONICAL" | "DRAFT" | "IN_REVIEW";

export type PatchContentInput = {
  insert: Scalars["String"]["input"];
  offset: Scalars["Int"]["input"];
  removeCount: Scalars["Int"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type PersonalTag = {
  id: Scalars["OID"]["output"];
  name: Scalars["String"]["output"];
};

export type Provenance = {
  author: Maybe<Scalars["String"]["output"]>;
  createdAt: Maybe<Scalars["DateTime"]["output"]>;
  sessionId: Maybe<Scalars["String"]["output"]>;
  sourceOrigin: Maybe<SourceOrigin>;
  updatedAt: Maybe<Scalars["DateTime"]["output"]>;
};

export type RejectNoteInput = {
  actor: Scalars["String"]["input"];
  comment: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  timestamp: Scalars["DateTime"]["input"];
};

export type RemoveLinkInput = {
  id: Scalars["OID"]["input"];
};

export type RemoveTopicInput = {
  id: Scalars["OID"]["input"];
};

export type RestoreNoteInput = {
  actor: Scalars["String"]["input"];
  comment?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  timestamp: Scalars["DateTime"]["input"];
};

export type SetContentInput = {
  content: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type SetDescriptionInput = {
  description: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type SetLastViewedInput = {
  lastViewedAt: Scalars["DateTime"]["input"];
};

export type SetMetadataFieldInput = {
  field: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
  value?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetMetadataListFieldInput = {
  field: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
  values: Array<Scalars["String"]["input"]>;
};

export type SetNoteTypeInput = {
  noteType: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type SetProvenanceInput = {
  author: Scalars["String"]["input"];
  createdAt: Scalars["DateTime"]["input"];
  sessionId?: InputMaybe<Scalars["String"]["input"]>;
  sourceOrigin: SourceOrigin;
};

export type SetTitleInput = {
  title: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type SourceOrigin = "DERIVED" | "IMPORT" | "MANUAL" | "SESSION_MINE";

export type SubmitForReviewInput = {
  actor: Scalars["String"]["input"];
  comment?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  timestamp: Scalars["DateTime"]["input"];
};

export type Topic = {
  id: Scalars["OID"]["output"];
  name: Scalars["String"]["output"];
  topicDocumentId: Maybe<Scalars["String"]["output"]>;
};

export type UpdateLinkTypeInput = {
  id: Scalars["OID"]["input"];
  linkType: LinkType;
};
