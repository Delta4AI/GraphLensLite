import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ==========================================================================
// Landing-page WebGL2 gating (markup half). On a failed probe gll.js unhides
// #landingWebglWarning and disables every [data-needs-webgl] button, so the
// markup carries the contract: a missing placeholder silently drops the
// warning, a missing attribute leaves an action whose only outcome is a
// graph-less stage. The probe and message renderer themselves are covered in
// webgl-support.test.js.
// ==========================================================================

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(repoRoot, "src/graph_lens_lite.html"), "utf8");
const landing = html.slice(
  html.indexOf('<div id="landingPage">'),
  html.indexOf('<div id="loadingOverlay"'),
);

describe("landing page WebGL gating markup", () => {
  it("has the warning placeholder, hidden by default", () => {
    const tag = landing.match(/<div id="landingWebglWarning"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(tag[0]).toContain("hidden");
  });

  it("marks every graph-creating action as WebGL-dependent", () => {
    const gated = landing
      .split("<button ")
      .slice(1)
      .map((chunk) => chunk.slice(0, chunk.indexOf(">")))
      .filter((tag) => tag.includes("data-needs-webgl"))
      .map((tag) => tag.match(/onclick="([^"]+)"/)?.[1]);

    expect(gated).toEqual([
      "document.getElementById('fileInput').click()",
      "loadDemoData()",
      "loadNeo4jData()",
      "startTour()",
    ]);
  });

  it("leaves the template download usable — it needs no renderer", () => {
    const templateBtn = landing.match(/<button [^>]*downloadExcelTemplate[^>]*>/);
    expect(templateBtn).not.toBeNull();
    expect(templateBtn[0]).not.toContain("data-needs-webgl");
  });
});
