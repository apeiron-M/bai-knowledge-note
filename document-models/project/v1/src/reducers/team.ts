import type { ProjectTeamOperations } from "document-models/project/v1";
import {
  DuplicateMemberError,
  MemberNotFoundError,
} from "../../gen/team/error.js";

export const projectTeamOperations: ProjectTeamOperations = {
  addMemberOperation(state, action) {
    if (state.team.some((m) => m.id === action.input.id))
      throw new DuplicateMemberError("Member already exists");
    state.team.push({
      id: action.input.id, name: action.input.name,
      role: action.input.role || null, kind: action.input.kind || null,
    });
  },
  updateMemberOperation(state, action) {
    const m = state.team.find((m) => m.id === action.input.id);
    if (!m) throw new MemberNotFoundError("Member not found");
    if (action.input.name) m.name = action.input.name;
    if (action.input.role) m.role = action.input.role;
    if (action.input.kind) m.kind = action.input.kind;
  },
  removeMemberOperation(state, action) {
    const i = state.team.findIndex((m) => m.id === action.input.id);
    if (i === -1) throw new MemberNotFoundError("Member not found");
    state.team.splice(i, 1);
  },
};
