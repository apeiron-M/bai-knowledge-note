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

export type AddTaskInput = {
  batchId?: InputMaybe<Scalars["String"]["input"]>;
  createdAt: Scalars["DateTime"]["input"];
  currentPhase?: InputMaybe<Scalars["String"]["input"]>;
  documentRef?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  target: Scalars["String"]["input"];
  taskType: Scalars["String"]["input"];
};

export type AdvancePhaseInput = {
  handoff: PhaseHandoffInput;
  taskId: Scalars["OID"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type AssignTaskInput = {
  assignedTo: Scalars["String"]["input"];
  taskId: Scalars["OID"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type BlockTaskInput = {
  reason: Scalars["String"]["input"];
  taskId: Scalars["OID"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type CompleteTaskInput = {
  taskId: Scalars["OID"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type FailTaskInput = {
  reason: Scalars["String"]["input"];
  taskId: Scalars["OID"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};

export type LearningCategory =
  | "FRICTION"
  | "METHODOLOGY"
  | "PROCESS_GAP"
  | "SURPRISE";

export type PhaseHandoff = {
  completedAt: Scalars["DateTime"]["output"];
  completedBy: Maybe<Scalars["String"]["output"]>;
  filesModified: Array<Scalars["String"]["output"]>;
  id: Scalars["OID"]["output"];
  learnings: Array<PhaseLearning>;
  phase: Scalars["String"]["output"];
  workDone: Scalars["String"]["output"];
};

export type PhaseHandoffInput = {
  completedAt: Scalars["DateTime"]["input"];
  completedBy?: InputMaybe<Scalars["String"]["input"]>;
  filesModified: Array<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  phase: Scalars["String"]["input"];
  workDone: Scalars["String"]["input"];
};

export type PhaseLearning = {
  category: LearningCategory;
  description: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
};

export type PhaseOrderEntry = {
  phases: Array<Scalars["String"]["output"]>;
  taskType: Scalars["String"]["output"];
};

export type PipelineQueueState = {
  activeCount: Scalars["Int"]["output"];
  completedCount: Scalars["Int"]["output"];
  lastProcessedAt: Maybe<Scalars["DateTime"]["output"]>;
  phaseOrder: Array<PhaseOrderEntry>;
  schemaVersion: Scalars["Int"]["output"];
  tasks: Array<PipelineTask>;
};

export type PipelineTask = {
  assignedTo: Maybe<Scalars["String"]["output"]>;
  batchId: Maybe<Scalars["String"]["output"]>;
  completedPhases: Array<Scalars["String"]["output"]>;
  createdAt: Scalars["DateTime"]["output"];
  currentPhase: Maybe<Scalars["String"]["output"]>;
  documentRef: Maybe<Scalars["String"]["output"]>;
  handoffs: Array<PhaseHandoff>;
  id: Scalars["OID"]["output"];
  status: TaskStatus;
  target: Scalars["String"]["output"];
  taskType: Scalars["String"]["output"];
  updatedAt: Maybe<Scalars["DateTime"]["output"]>;
};

export type TaskStatus =
  | "BLOCKED"
  | "DONE"
  | "FAILED"
  | "IN_PROGRESS"
  | "PENDING";

export type UnblockTaskInput = {
  taskId: Scalars["OID"]["input"];
  updatedAt: Scalars["DateTime"]["input"];
};
