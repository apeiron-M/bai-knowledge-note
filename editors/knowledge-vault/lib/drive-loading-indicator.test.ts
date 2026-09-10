import { describe, expect, it } from "vitest";
import {
  hideDriveLoading,
  showDriveLoading,
} from "./drive-loading-indicator.js";

describe("drive loading indicator", () => {
  it("is a safe no-op without a DOM", () => {
    expect(() => {
      showDriveLoading();
      showDriveLoading();
      hideDriveLoading();
      hideDriveLoading();
    }).not.toThrow();
  });

  it("tolerates a hide without a matching show", () => {
    expect(() => hideDriveLoading()).not.toThrow();
  });
});
