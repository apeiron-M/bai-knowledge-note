/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddDeliverableInput,
  AddKnowledgeRefInput,
  AddMemberInput,
  CreateProjectInput,
  Deliverable,
  DeliverableStatus,
  LinkWbsInput,
  MemberKind,
  ProjectState,
  ProjectStatus,
  RemoveDeliverableInput,
  RemoveKnowledgeRefInput,
  RemoveMemberInput,
  SetDeliverableStatusInput,
  SetOwnerInput,
  SetProjectStatusInput,
  SetReferencesInput,
  SetTargetDateInput,
  TeamMember,
  UpdateDeliverableInput,
  UpdateMemberInput,
  UpdateProjectInfoInput,
} from "./types.js";

type Properties<T> = Required<{
  [K in keyof T]: z.ZodType<T[K]>;
}>;

type definedNonNullAny = {};

export const isDefinedNonNullAny = (v: any): v is definedNonNullAny =>
  v !== undefined && v !== null;

export const definedNonNullAnySchema = z
  .any()
  .refine((v) => isDefinedNonNullAny(v));

export const DeliverableStatusSchema = z.enum([
  "CANCELLED",
  "DELIVERED",
  "IN_PROGRESS",
  "PLANNED",
]);

export const MemberKindSchema = z.enum(["AGENT", "HUMAN"]);

export const ProjectStatusSchema = z.enum([
  "ACTIVE",
  "ARCHIVED",
  "COMPLETED",
  "ON_HOLD",
  "PLANNING",
]);

export function AddDeliverableInputSchema(): z.ZodObject<
  Properties<AddDeliverableInput>
> {
  return z.object({
    description: z.string().nullish(),
    goalRef: z.string().nullish(),
    id: z.string(),
    title: z.string(),
    url: z.url().nullish(),
  });
}

export function AddKnowledgeRefInputSchema(): z.ZodObject<
  Properties<AddKnowledgeRefInput>
> {
  return z.object({
    ref: z.string(),
  });
}

export function AddMemberInputSchema(): z.ZodObject<
  Properties<AddMemberInput>
> {
  return z.object({
    id: z.string(),
    kind: MemberKindSchema.nullish(),
    name: z.string(),
    role: z.string().nullish(),
  });
}

export function CreateProjectInputSchema(): z.ZodObject<
  Properties<CreateProjectInput>
> {
  return z.object({
    createdAt: z.iso.datetime(),
    description: z.string().nullish(),
    name: z.string(),
    owner: z.string().nullish(),
    status: ProjectStatusSchema.nullish(),
  });
}

export function DeliverableSchema(): z.ZodObject<Properties<Deliverable>> {
  return z.object({
    __typename: z.literal("Deliverable").optional(),
    deliveredAt: z.iso.datetime().nullish(),
    description: z.string().nullish(),
    goalRef: z.string().nullish(),
    id: z.string(),
    status: DeliverableStatusSchema,
    title: z.string(),
    url: z.url().nullish(),
  });
}

export function LinkWbsInputSchema(): z.ZodObject<Properties<LinkWbsInput>> {
  return z.object({
    wbsRef: z.string().nullish(),
  });
}

export function ProjectStateSchema(): z.ZodObject<Properties<ProjectState>> {
  return z.object({
    __typename: z.literal("ProjectState").optional(),
    createdAt: z.iso.datetime().nullish(),
    deliverables: z.array(z.lazy(() => DeliverableSchema())),
    description: z.string().nullish(),
    knowledgeRefs: z.array(z.string()),
    name: z.string().nullish(),
    owner: z.string().nullish(),
    references: z.array(z.url()),
    status: ProjectStatusSchema,
    targetDate: z.iso.datetime().nullish(),
    team: z.array(z.lazy(() => TeamMemberSchema())),
    wbsRef: z.string().nullish(),
  });
}

export function RemoveDeliverableInputSchema(): z.ZodObject<
  Properties<RemoveDeliverableInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RemoveKnowledgeRefInputSchema(): z.ZodObject<
  Properties<RemoveKnowledgeRefInput>
> {
  return z.object({
    ref: z.string(),
  });
}

export function RemoveMemberInputSchema(): z.ZodObject<
  Properties<RemoveMemberInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function SetDeliverableStatusInputSchema(): z.ZodObject<
  Properties<SetDeliverableStatusInput>
> {
  return z.object({
    deliveredAt: z.iso.datetime().nullish(),
    id: z.string(),
    status: DeliverableStatusSchema,
  });
}

export function SetOwnerInputSchema(): z.ZodObject<Properties<SetOwnerInput>> {
  return z.object({
    owner: z.string().nullish(),
  });
}

export function SetProjectStatusInputSchema(): z.ZodObject<
  Properties<SetProjectStatusInput>
> {
  return z.object({
    status: ProjectStatusSchema,
  });
}

export function SetReferencesInputSchema(): z.ZodObject<
  Properties<SetReferencesInput>
> {
  return z.object({
    references: z.array(z.url()),
  });
}

export function SetTargetDateInputSchema(): z.ZodObject<
  Properties<SetTargetDateInput>
> {
  return z.object({
    targetDate: z.iso.datetime().nullish(),
  });
}

export function TeamMemberSchema(): z.ZodObject<Properties<TeamMember>> {
  return z.object({
    __typename: z.literal("TeamMember").optional(),
    id: z.string(),
    kind: MemberKindSchema.nullish(),
    name: z.string(),
    role: z.string().nullish(),
  });
}

export function UpdateDeliverableInputSchema(): z.ZodObject<
  Properties<UpdateDeliverableInput>
> {
  return z.object({
    description: z.string().nullish(),
    goalRef: z.string().nullish(),
    id: z.string(),
    title: z.string().nullish(),
    url: z.url().nullish(),
  });
}

export function UpdateMemberInputSchema(): z.ZodObject<
  Properties<UpdateMemberInput>
> {
  return z.object({
    id: z.string(),
    kind: MemberKindSchema.nullish(),
    name: z.string().nullish(),
    role: z.string().nullish(),
  });
}

export function UpdateProjectInfoInputSchema(): z.ZodObject<
  Properties<UpdateProjectInfoInput>
> {
  return z.object({
    description: z.string().nullish(),
    name: z.string().nullish(),
  });
}
