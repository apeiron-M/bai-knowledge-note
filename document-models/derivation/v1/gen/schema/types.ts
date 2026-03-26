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

export type AddReseedEntryInput = {
  changes: Array<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  reason: Scalars["String"]["input"];
  reseededAt: Scalars["DateTime"]["input"];
};

export type AddSignalInput = {
  id: Scalars["OID"]["input"];
  influencedDimensions: Array<Scalars["String"]["input"]>;
  interpretation: Scalars["String"]["input"];
  utterance: Scalars["String"]["input"];
};

export type ClaimReference = {
  claimRef: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
  strength: Scalars["String"]["output"];
  supportsDecision: Scalars["String"]["output"];
};

export type CoherenceCheck = {
  coherent: Scalars["Boolean"]["output"];
  dimensionPair: Array<Scalars["String"]["output"]>;
  explanation: Scalars["String"]["output"];
};

export type DerivationSignal = {
  id: Scalars["OID"]["output"];
  influencedDimensions: Array<Scalars["String"]["output"]>;
  interpretation: Scalars["String"]["output"];
  utterance: Scalars["String"]["output"];
};

export type DerivationState = {
  claimReferences: Array<ClaimReference>;
  coherenceResults: Array<CoherenceCheck>;
  derivedAt: Maybe<Scalars["DateTime"]["output"]>;
  dimensionRationale: Array<DimensionRationale>;
  engineVersion: Maybe<Scalars["String"]["output"]>;
  featureDecisions: Array<FeatureDecision>;
  reseedHistory: Array<ReseedEntry>;
  signals: Array<DerivationSignal>;
};

export type DimensionRationale = {
  confidence: Scalars["Float"]["output"];
  dimension: Scalars["String"]["output"];
  failureModes: Array<Scalars["String"]["output"]>;
  position: Scalars["Int"]["output"];
  rationale: Scalars["String"]["output"];
  supportingClaims: Array<Scalars["String"]["output"]>;
};

export type FeatureDecision = {
  enabled: Scalars["Boolean"]["output"];
  feature: Scalars["String"]["output"];
  rationale: Scalars["String"]["output"];
  supportingClaims: Array<Scalars["String"]["output"]>;
};

export type InitializeDerivationInput = {
  derivedAt: Scalars["DateTime"]["input"];
  engineVersion: Scalars["String"]["input"];
};

export type ReseedEntry = {
  changes: Array<Scalars["String"]["output"]>;
  id: Scalars["OID"]["output"];
  reason: Scalars["String"]["output"];
  reseededAt: Scalars["DateTime"]["output"];
};

export type UpdateDimensionRationaleInput = {
  confidence: Scalars["Float"]["input"];
  dimension: Scalars["String"]["input"];
  failureModes: Array<Scalars["String"]["input"]>;
  position: Scalars["Int"]["input"];
  rationale: Scalars["String"]["input"];
  supportingClaims: Array<Scalars["String"]["input"]>;
};
