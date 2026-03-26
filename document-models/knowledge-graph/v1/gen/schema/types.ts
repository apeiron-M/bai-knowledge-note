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

export type AddEdgeInput = {
  id: Scalars["OID"]["input"];
  linkType?: InputMaybe<Scalars["String"]["input"]>;
  sourceDocumentId: Scalars["String"]["input"];
  targetDocumentId: Scalars["String"]["input"];
};

export type AddNodeInput = {
  documentId: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  noteType?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type GraphEdge = {
  id: Scalars["OID"]["output"];
  linkType: Maybe<Scalars["String"]["output"]>;
  sourceDocumentId: Scalars["String"]["output"];
  targetDocumentId: Scalars["String"]["output"];
};

export type GraphEdgeInput = {
  id: Scalars["OID"]["input"];
  linkType?: InputMaybe<Scalars["String"]["input"]>;
  sourceDocumentId: Scalars["String"]["input"];
  targetDocumentId: Scalars["String"]["input"];
};

export type GraphNode = {
  documentId: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
  noteType: Maybe<Scalars["String"]["output"]>;
  status: Maybe<Scalars["String"]["output"]>;
  title: Maybe<Scalars["String"]["output"]>;
};

export type GraphNodeInput = {
  documentId: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  noteType?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};

export type KnowledgeGraphState = {
  edges: Array<GraphEdge>;
  lastSyncedAt: Maybe<Scalars["DateTime"]["output"]>;
  nodes: Array<GraphNode>;
};

export type RemoveEdgeInput = {
  id: Scalars["OID"]["input"];
};

export type RemoveNodeInput = {
  documentId: Scalars["String"]["input"];
};

export type SyncGraphInput = {
  edges: Array<GraphEdgeInput>;
  nodes: Array<GraphNodeInput>;
  syncedAt: Scalars["DateTime"]["input"];
};

export type UpdateEdgeInput = {
  id: Scalars["OID"]["input"];
  linkType?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateNodeInput = {
  documentId: Scalars["String"]["input"];
  noteType?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<Scalars["String"]["input"]>;
  title?: InputMaybe<Scalars["String"]["input"]>;
};
