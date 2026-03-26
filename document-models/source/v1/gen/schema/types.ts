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

export type AddExtractedClaimInput = {
  claimRef: Scalars["String"]["input"];
};

export type ExtractionStats = {
  claimCount: Scalars["Int"]["output"];
  extractedAt: Maybe<Scalars["DateTime"]["output"]>;
  extractedBy: Maybe<Scalars["String"]["output"]>;
  skipRate: Scalars["Float"]["output"];
  skippedCount: Scalars["Int"]["output"];
};

export type IngestSourceInput = {
  author?: InputMaybe<Scalars["String"]["input"]>;
  content: Scalars["String"]["input"];
  createdAt: Scalars["DateTime"]["input"];
  createdBy?: InputMaybe<Scalars["String"]["input"]>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  method?: InputMaybe<Scalars["String"]["input"]>;
  publishedAt?: InputMaybe<Scalars["DateTime"]["input"]>;
  sourceType: SourceType;
  title: Scalars["String"]["input"];
  tool?: InputMaybe<Scalars["String"]["input"]>;
  url?: InputMaybe<Scalars["String"]["input"]>;
};

export type RecordExtractionStatsInput = {
  claimCount: Scalars["Int"]["input"];
  extractedAt: Scalars["DateTime"]["input"];
  extractedBy?: InputMaybe<Scalars["String"]["input"]>;
  skipRate: Scalars["Float"]["input"];
  skippedCount: Scalars["Int"]["input"];
};

export type SetSourceStatusInput = {
  status: SourceStatus;
};

export type SourceProvenance = {
  author: Maybe<Scalars["String"]["output"]>;
  method: Maybe<Scalars["String"]["output"]>;
  publishedAt: Maybe<Scalars["DateTime"]["output"]>;
  tool: Maybe<Scalars["String"]["output"]>;
  url: Maybe<Scalars["String"]["output"]>;
};

export type SourceState = {
  content: Maybe<Scalars["String"]["output"]>;
  createdAt: Maybe<Scalars["DateTime"]["output"]>;
  createdBy: Maybe<Scalars["String"]["output"]>;
  description: Maybe<Scalars["String"]["output"]>;
  extractedClaims: Array<Scalars["String"]["output"]>;
  extractionStats: Maybe<ExtractionStats>;
  provenance: Maybe<SourceProvenance>;
  sourceType: Maybe<SourceType>;
  status: Maybe<SourceStatus>;
  title: Maybe<Scalars["String"]["output"]>;
};

export type SourceStatus = "ARCHIVED" | "EXTRACTED" | "EXTRACTING" | "INBOX";

export type SourceType =
  | "ARTICLE"
  | "BOOK_CHAPTER"
  | "CONVERSATION"
  | "DOCUMENTATION"
  | "MANUAL_ENTRY"
  | "PAPER"
  | "TRANSCRIPT"
  | "WEB_PAGE";
