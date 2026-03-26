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

export type AddExtractionCategoryInput = {
  active: Scalars["Boolean"]["input"];
  description: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
  name: Scalars["String"]["input"];
};

export type DimensionConfig = {
  automation: DimensionPosition;
  granularity: DimensionPosition;
  linking: DimensionPosition;
  maintenance: DimensionPosition;
  navigation: DimensionPosition;
  organization: DimensionPosition;
  processing: DimensionPosition;
  schema: DimensionPosition;
};

export type DimensionPosition = {
  confidence: Scalars["Float"]["output"];
  rationale: Maybe<Scalars["String"]["output"]>;
  value: Scalars["Int"]["output"];
};

export type ExtractionCategory = {
  active: Scalars["Boolean"]["output"];
  description: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
  name: Scalars["String"]["output"];
};

export type InitializeConfigInput = {
  domain: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type MaintenanceConfig = {
  danglingThreshold: Scalars["Int"]["output"];
  inboxPressure: Scalars["Int"]["output"];
  mocOversize: Scalars["Int"]["output"];
  observationAccumulation: Scalars["Int"]["output"];
  orphanThreshold: Scalars["Int"]["output"];
  staleNoteDays: Scalars["Int"]["output"];
  tensionAccumulation: Scalars["Int"]["output"];
};

export type MocSchemaConfig = {
  requiredFields: Array<Scalars["String"]["output"]>;
  tierValues: Array<Scalars["String"]["output"]>;
};

export type NoteSchemaConfig = {
  confidenceValues: Array<Scalars["String"]["output"]>;
  kindValues: Array<Scalars["String"]["output"]>;
  optionalFields: Array<Scalars["String"]["output"]>;
  requiredFields: Array<Scalars["String"]["output"]>;
};

export type PipelineConfig = {
  autoChain: Scalars["Boolean"]["output"];
  depth: Scalars["String"]["output"];
  extractionSelectivity: Scalars["Float"]["output"];
};

export type ToggleExtractionCategoryInput = {
  active: Scalars["Boolean"]["input"];
  id: Scalars["OID"]["input"];
};

export type ToggleFeatureInput = {
  enabled: Scalars["Boolean"]["input"];
  feature: Scalars["String"]["input"];
};

export type UpdateDimensionInput = {
  confidence: Scalars["Float"]["input"];
  dimension: Scalars["String"]["input"];
  rationale?: InputMaybe<Scalars["String"]["input"]>;
  updatedAt: Scalars["DateTime"]["input"];
  value: Scalars["Int"]["input"];
};

export type UpdateMaintenanceThresholdInput = {
  condition: Scalars["String"]["input"];
  threshold: Scalars["Int"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type UpdatePipelineConfigInput = {
  autoChain?: InputMaybe<Scalars["Boolean"]["input"]>;
  depth?: InputMaybe<Scalars["String"]["input"]>;
  extractionSelectivity?: InputMaybe<Scalars["Float"]["input"]>;
  updatedAt: Scalars["DateTime"]["input"];
};

export type UpdateVocabularyInput = {
  key: Scalars["String"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
  value: Scalars["String"]["input"];
};

export type VaultConfigState = {
  dimensions: Maybe<DimensionConfig>;
  domain: Maybe<Scalars["String"]["output"]>;
  extractionCategories: Array<ExtractionCategory>;
  features: Array<Scalars["String"]["output"]>;
  maintenance: Maybe<MaintenanceConfig>;
  mocSchema: Maybe<MocSchemaConfig>;
  name: Maybe<Scalars["String"]["output"]>;
  noteSchema: Maybe<NoteSchemaConfig>;
  pipeline: Maybe<PipelineConfig>;
  updatedAt: Maybe<Scalars["DateTime"]["output"]>;
  vocabulary: Maybe<VocabularyMap>;
};

export type VocabularyMap = {
  description: Scalars["String"]["output"];
  inbox: Scalars["String"]["output"];
  notes: Scalars["String"]["output"];
  reduce: Scalars["String"]["output"];
  reflect: Scalars["String"]["output"];
  rethink: Scalars["String"]["output"];
  reweave: Scalars["String"]["output"];
  topicMap: Scalars["String"]["output"];
  verify: Scalars["String"]["output"];
};
