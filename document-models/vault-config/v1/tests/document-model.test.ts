/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import { describe, it, expect } from "vitest";
import {
  utils,
  initialGlobalState,
  initialLocalState,
  vaultConfigDocumentType,
  isVaultConfigDocument,
  assertIsVaultConfigDocument,
  isVaultConfigState,
  assertIsVaultConfigState,
} from "document-models/vault-config/v1";
import { ZodError } from "zod";

describe("VaultConfig Document Model", () => {
  it("should create a new VaultConfig document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(vaultConfigDocumentType);
  });

  it("should create a new VaultConfig document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isVaultConfigDocument(document)).toBe(true);
    expect(isVaultConfigState(document.state)).toBe(true);
  });
  it("should reject a document that is not a VaultConfig document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsVaultConfigDocument(wrongDocumentType)).toThrow();
      expect(isVaultConfigDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  const wrongState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongState.state.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isVaultConfigState(wrongState.state)).toBe(false);
    expect(assertIsVaultConfigState(wrongState.state)).toThrow();
    expect(isVaultConfigDocument(wrongState)).toBe(false);
    expect(assertIsVaultConfigDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isVaultConfigState(wrongInitialState.state)).toBe(false);
    expect(assertIsVaultConfigState(wrongInitialState.state)).toThrow();
    expect(isVaultConfigDocument(wrongInitialState)).toBe(false);
    expect(assertIsVaultConfigDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isVaultConfigDocument(missingIdInHeader)).toBe(false);
    expect(assertIsVaultConfigDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isVaultConfigDocument(missingNameInHeader)).toBe(false);
    expect(assertIsVaultConfigDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isVaultConfigDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsVaultConfigDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isVaultConfigDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsVaultConfigDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
