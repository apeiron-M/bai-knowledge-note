import type { ScopeOfWorkScopeOfWorkOperations } from "document-models/scope-of-work/v1";
import type { ScopeOfWorkStatusInput } from "../../gen/schema/index.js";

export const scopeOfWorkScopeOfWorkOperations: ScopeOfWorkScopeOfWorkOperations =
  {
    editScopeOfWorkOperation(state, action) {
      state.title = action.input.title ?? state.title;
      state.description = action.input.description ?? state.description;
      state.status =
        (action.input.status as ScopeOfWorkStatusInput) ?? state.status;
    },
  };
