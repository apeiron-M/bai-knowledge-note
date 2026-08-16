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
  AttachmentRef: {
    input: `attachment://v${number}:${string}`;
    output: `attachment://v${number}:${string}`;
  };
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

export type AddDeliverableInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  goalRef?: InputMaybe<Scalars["OID"]["input"]>;
  id: Scalars["OID"]["input"];
  title: Scalars["String"]["input"];
  url?: InputMaybe<Scalars["URL"]["input"]>;
};

export type AddKnowledgeRefInput = {
  ref: Scalars["PHID"]["input"];
};

export type AddMemberInput = {
  id: Scalars["OID"]["input"];
  kind?: InputMaybe<MemberKind>;
  name: Scalars["String"]["input"];
  role?: InputMaybe<Scalars["String"]["input"]>;
};

export type CreateProjectInput = {
  createdAt: Scalars["DateTime"]["input"];
  description?: InputMaybe<Scalars["String"]["input"]>;
  name: Scalars["String"]["input"];
  owner?: InputMaybe<Scalars["String"]["input"]>;
  status?: InputMaybe<ProjectStatus>;
};

export type Deliverable = {
  deliveredAt: Maybe<Scalars["DateTime"]["output"]>;
  description: Maybe<Scalars["String"]["output"]>;
  goalRef: Maybe<Scalars["OID"]["output"]>;
  id: Scalars["OID"]["output"];
  status: DeliverableStatus;
  title: Scalars["String"]["output"];
  url: Maybe<Scalars["URL"]["output"]>;
};

export type DeliverableStatus =
  | "CANCELLED"
  | "DELIVERED"
  | "IN_PROGRESS"
  | "PLANNED";

export type LinkWbsInput = {
  wbsRef?: InputMaybe<Scalars["PHID"]["input"]>;
};

export type MemberKind = "AGENT" | "HUMAN";

export type ProjectState = {
  createdAt: Maybe<Scalars["DateTime"]["output"]>;
  deliverables: Array<Deliverable>;
  description: Maybe<Scalars["String"]["output"]>;
  knowledgeRefs: Array<Scalars["PHID"]["output"]>;
  name: Maybe<Scalars["String"]["output"]>;
  owner: Maybe<Scalars["String"]["output"]>;
  references: Array<Scalars["URL"]["output"]>;
  status: ProjectStatus;
  targetDate: Maybe<Scalars["Date"]["output"]>;
  team: Array<TeamMember>;
  wbsRef: Maybe<Scalars["PHID"]["output"]>;
};

export type ProjectStatus =
  | "ACTIVE"
  | "ARCHIVED"
  | "COMPLETED"
  | "ON_HOLD"
  | "PLANNING";

export type RemoveDeliverableInput = {
  id: Scalars["OID"]["input"];
};

export type RemoveKnowledgeRefInput = {
  ref: Scalars["PHID"]["input"];
};

export type RemoveMemberInput = {
  id: Scalars["OID"]["input"];
};

export type SetDeliverableStatusInput = {
  deliveredAt?: InputMaybe<Scalars["DateTime"]["input"]>;
  id: Scalars["OID"]["input"];
  status: DeliverableStatus;
};

export type SetOwnerInput = {
  owner?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetProjectStatusInput = {
  status: ProjectStatus;
};

export type SetReferencesInput = {
  references: Array<Scalars["URL"]["input"]>;
};

export type SetTargetDateInput = {
  targetDate?: InputMaybe<Scalars["Date"]["input"]>;
};

export type TeamMember = {
  id: Scalars["OID"]["output"];
  kind: Maybe<MemberKind>;
  name: Scalars["String"]["output"];
  role: Maybe<Scalars["String"]["output"]>;
};

export type UpdateDeliverableInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  goalRef?: InputMaybe<Scalars["OID"]["input"]>;
  id: Scalars["OID"]["input"];
  title?: InputMaybe<Scalars["String"]["input"]>;
  url?: InputMaybe<Scalars["URL"]["input"]>;
};

export type UpdateMemberInput = {
  id: Scalars["OID"]["input"];
  kind?: InputMaybe<MemberKind>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  role?: InputMaybe<Scalars["String"]["input"]>;
};

export type UpdateProjectInfoInput = {
  description?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
};
