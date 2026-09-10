import { describe, expect, it } from "vitest";
import {
  installDriveAuthModalDismissal,
  isDriveAuthModalOpen,
} from "./dismiss-drive-auth-modal.js";

describe("isDriveAuthModalOpen", () => {
  it("is true only for Connect's drive-auth modal", () => {
    expect(isDriveAuthModalOpen("driveAuthRequired")).toBe(true);
  });

  it("is false for any other modal or none", () => {
    for (const type of ["createDocument", "deleteItem", "login", undefined]) {
      expect(isDriveAuthModalOpen(type)).toBe(false);
    }
  });
});

describe("installDriveAuthModalDismissal", () => {
  it("is a safe no-op without a DOM, and returns a cleanup", () => {
    const uninstall = installDriveAuthModalDismissal();
    expect(typeof uninstall).toBe("function");
    expect(() => uninstall()).not.toThrow();
  });
});
