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

export type AddChildMocInput = {
  childRef: Scalars["String"]["input"];
};

export type AddCoreIdeaInput = {
  addedAt: Scalars["DateTime"]["input"];
  addedBy?: InputMaybe<Scalars["String"]["input"]>;
  contextPhrase: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  noteRef: Scalars["String"]["input"];
  sortOrder: Scalars["Int"]["input"];
};

export type AddOpenQuestionInput = {
  question: Scalars["String"]["input"];
};

export type AddTensionInput = {
  addedAt: Scalars["DateTime"]["input"];
  description: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  involvedRefs: Array<Scalars["String"]["input"]>;
};

export type CreateMocInput = {
  createdAt: Scalars["DateTime"]["input"];
  description: Scalars["String"]["input"];
  orientation: Scalars["String"]["input"];
  parentRef?: InputMaybe<Scalars["String"]["input"]>;
  tier: MocTier;
  title: Scalars["String"]["input"];
};

export type MocEntry = {
  addedAt: Maybe<Scalars["DateTime"]["output"]>;
  addedBy: Maybe<Scalars["String"]["output"]>;
  contextPhrase: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
  noteRef: Scalars["String"]["output"];
  sortOrder: Scalars["Int"]["output"];
};

export type MocState = {
  agentNotes: Array<Scalars["String"]["output"]>;
  childRefs: Array<Scalars["String"]["output"]>;
  coreIdeas: Array<MocEntry>;
  createdAt: Maybe<Scalars["DateTime"]["output"]>;
  description: Maybe<Scalars["String"]["output"]>;
  noteCount: Maybe<Scalars["Int"]["output"]>;
  openQuestions: Array<Scalars["String"]["output"]>;
  orientation: Maybe<Scalars["String"]["output"]>;
  parentRef: Maybe<Scalars["String"]["output"]>;
  tensions: Array<MocTensionEntry>;
  tier: Maybe<MocTier>;
  title: Maybe<Scalars["String"]["output"]>;
  updatedAt: Maybe<Scalars["DateTime"]["output"]>;
};

export type MocTensionEntry = {
  addedAt: Maybe<Scalars["DateTime"]["output"]>;
  description: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
  involvedRefs: Array<Scalars["String"]["output"]>;
};

export type MocTier = "DOMAIN" | "HUB" | "TOPIC";

export type RemoveChildMocInput = {
  childRef: Scalars["String"]["input"];
};

export type RemoveCoreIdeaInput = {
  id: Scalars["OID"]["input"];
};

export type RemoveOpenQuestionInput = {
  question: Scalars["String"]["input"];
};

export type RemoveTensionInput = {
  id: Scalars["OID"]["input"];
};

export type ReorderCoreIdeasInput = {
  ids: Array<Scalars["OID"]["input"]>;
};

export type UpdateCoreIdeaInput = {
  contextPhrase?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  sortOrder?: InputMaybe<Scalars["Int"]["input"]>;
};

export type UpdateDescriptionInput = {
  description: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type UpdateOrientationInput = {
  orientation: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};
