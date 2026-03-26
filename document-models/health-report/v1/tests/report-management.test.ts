import { generateMock } from "@powerhousedao/common/utils";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isHealthReportDocument,
  generateReport,
  addCheck,
  GenerateReportInputSchema,
  AddCheckInputSchema,
} from "knowledge-note/document-models/health-report/v1";

describe("ReportManagementOperations", () => {
  it("should handle generateReport operation", () => {
    const document = utils.createDocument();
    const input = generateMock(GenerateReportInputSchema());

    const updatedDocument = reducer(document, generateReport(input));

    expect(isHealthReportDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "GENERATE_REPORT",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addCheck operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddCheckInputSchema());

    const updatedDocument = reducer(document, addCheck(input));

    expect(isHealthReportDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_CHECK");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
