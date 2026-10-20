import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostModelMissing } from "./HostModelMissing.js";

describe("HostModelMissing", () => {
  it("says no model is set up and offers the app's settings", () => {
    const html = renderToStaticMarkup(<HostModelMissing vaultName="Research" onOpenSettings={() => {}} />);
    expect(html).toContain("No AI model is set up yet");
    expect(html).toContain("Set up an AI model");
  });
  it("without an opener, says where to go instead of showing a dead button", () => {
    const html = renderToStaticMarkup(<HostModelMissing vaultName="Research" onOpenSettings={null} />);
    expect(html).toContain("Settings › Models");
    expect(html).not.toContain("<button");
  });
});
