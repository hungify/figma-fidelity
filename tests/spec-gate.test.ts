import { describe, expect, it } from "vitest";

import { specGate, specSizeTolerance } from "../src/index.ts";

function figmaOk(box: { width: number; height: number }): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        lastModified: "2026-07-17T13:39:46Z",
        nodes: { "153:5181": { document: { absoluteBoundingBox: box } } },
      }),
      { status: 200 },
    )) as typeof fetch;
}

const base = { fileKey: "abc", nodeId: "153:5181", token: "t" };

describe("spec gate (Figma REST spec ↔ DOM size)", () => {
  it("tolerance is max(2px, 0.5%)", () => {
    expect(specSizeTolerance(100)).toBe(2);
    expect(specSizeTolerance(544)).toBeCloseTo(2.72);
  });

  it("DOM matches spec within tolerance → pass", async () => {
    const r = await specGate({
      ...base,
      domSize: { width: 545, height: 463 },
      fetchImpl: figmaOk({ width: 544, height: 464 }),
    });
    expect(r.pass).toBe(true);
    expect(r.topIssues).toHaveLength(0);
  });

  it("DOM off-spec → hard-fail with spec-size-mismatch (distinct from areaGap's size kind)", async () => {
    const r = await specGate({
      ...base,
      domSize: { width: 386, height: 449 },
      fetchImpl: figmaOk({ width: 544, height: 464 }),
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues[0]?.kind).toBe("spec-size-mismatch");
    expect(r.topIssues[0]?.severity).toBe("high");
  });

  it("network error → skip with warning, never a fail", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const r = await specGate({ ...base, domSize: { width: 544, height: 464 }, fetchImpl });
    expect(r.pass).toBeNull();
    expect(r.topIssues).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/spec-gate skipped/);
  });

  it("no token → skip with warning", async () => {
    const r = await specGate({
      fileKey: "abc",
      nodeId: "153:5181",
      token: "",
      domSize: { width: 544, height: 464 },
    });
    expect(r.pass).toBeNull();
    expect(r.warnings[0]).toMatch(/no Figma token/);
  });
});
