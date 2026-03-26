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

export type AddCheckInput = {
  affectedItems: Array<Scalars["String"]["input"]>;
  category: HealthCategory;
  id: Scalars["OID"]["input"];
  message: Scalars["String"]["input"];
  status: HealthStatus;
};

export type GenerateReportInput = {
  generatedAt: Scalars["DateTime"]["input"];
  generatedBy?: InputMaybe<Scalars["String"]["input"]>;
  graphMetrics: GraphMetricsInput;
  mode: Scalars["String"]["input"];
  overallStatus: HealthStatus;
  recommendations: Array<Scalars["String"]["input"]>;
};

export type GraphMetrics = {
  averageLinksPerNote: Scalars["Float"]["output"];
  connectionCount: Scalars["Int"]["output"];
  danglingLinkCount: Scalars["Int"]["output"];
  density: Scalars["Float"]["output"];
  mocCount: Scalars["Int"]["output"];
  mocCoverage: Scalars["Float"]["output"];
  noteCount: Scalars["Int"]["output"];
  orphanCount: Scalars["Int"]["output"];
};

export type GraphMetricsInput = {
  averageLinksPerNote: Scalars["Float"]["input"];
  connectionCount: Scalars["Int"]["input"];
  danglingLinkCount: Scalars["Int"]["input"];
  density: Scalars["Float"]["input"];
  mocCount: Scalars["Int"]["input"];
  mocCoverage: Scalars["Float"]["input"];
  noteCount: Scalars["Int"]["input"];
  orphanCount: Scalars["Int"]["input"];
};

export type HealthCategory =
  | "DESCRIPTION_QUALITY"
  | "LINK_HEALTH"
  | "MOC_COHERENCE"
  | "ORPHAN_DETECTION"
  | "PROCESSING_THROUGHPUT"
  | "SCHEMA_COMPLIANCE"
  | "STALE_NOTES"
  | "THREE_SPACE_BOUNDARIES";

export type HealthCheck = {
  affectedItems: Array<Scalars["String"]["output"]>;
  category: HealthCategory;
  id: Scalars["OID"]["output"];
  message: Scalars["String"]["output"];
  status: HealthStatus;
};

export type HealthReportState = {
  checks: Array<HealthCheck>;
  generatedAt: Maybe<Scalars["DateTime"]["output"]>;
  generatedBy: Maybe<Scalars["String"]["output"]>;
  graphMetrics: Maybe<GraphMetrics>;
  mode: Maybe<Scalars["String"]["output"]>;
  overallStatus: Maybe<HealthStatus>;
  recommendations: Array<Scalars["String"]["output"]>;
};

export type HealthStatus = "FAIL" | "PASS" | "WARN";
