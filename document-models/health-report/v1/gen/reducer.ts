/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model";
import type { HealthReportPHState } from "document-models/health-report/v1";

import { healthReportReportManagementOperations } from "../src/reducers/report-management.js";

import {
  GenerateReportInputSchema,
  AddCheckInputSchema,
} from "./schema/zod.js";

const stateReducer: StateReducer<HealthReportPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "GENERATE_REPORT": {
      GenerateReportInputSchema().parse(action.input);

      healthReportReportManagementOperations.generateReportOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_CHECK": {
      AddCheckInputSchema().parse(action.input);

      healthReportReportManagementOperations.addCheckOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<HealthReportPHState> =
  createReducer(stateReducer);
