import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkDoneGate } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-donegate-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function scoreDir(score: Record<string, unknown>): string {
  const dir = path.join(tmp, `vp-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "visual-score.json"), JSON.stringify(score));
  return dir;
}

const NODE = "153:5181";

function goodScore(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pass: true,
    runType: "final",
    capturedAt: new Date().toISOString(),
    nodeId: NODE,
    viewport: "desktop",
    stability: "stable",
    ...overrides,
  };
}

describe("done gate (artifact-gated, per viewport, per stability)", () => {
  it("all green → done", () => {
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [{ viewport: "desktop", outDir: scoreDir(goodScore()) }],
    });
    expect(v.done).toBe(true);
  });

  it("missing viewport artifact → not done", () => {
    const empty = path.join(tmp, `vp-${n++}`);
    fs.mkdirSync(empty, { recursive: true });
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [
        { viewport: "desktop", outDir: scoreDir(goodScore()) },
        { viewport: "mobile", outDir: empty },
      ],
    });
    expect(v.done).toBe(false);
    expect(v.viewports[1]?.reasons[0]).toMatch(/missing visual-score\.json/);
  });

  it("runType dev → not done (fresh final run required)", () => {
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [{ viewport: "desktop", outDir: scoreDir(goodScore({ runType: "dev" })) }],
    });
    expect(v.done).toBe(false);
  });

  it("stale capturedAt → not done (score without fresh capture is invalid)", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [{ viewport: "desktop", outDir: scoreDir(goodScore({ capturedAt: old })) }],
    });
    expect(v.done).toBe(false);
    expect(v.viewports[0]?.reasons.some((r) => r.includes("older than"))).toBe(true);
  });

  it("wrong nodeId → not done", () => {
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [{ viewport: "desktop", outDir: scoreDir(goodScore({ nodeId: "153:2364" })) }],
    });
    expect(v.done).toBe(false);
  });

  it("borderline blocks done-gate for runType:final", () => {
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [
        { viewport: "desktop", outDir: scoreDir(goodScore({ stability: "borderline" })) },
      ],
    });
    expect(v.done).toBe(false);
    expect(v.viewports[0]?.reasons.some((r) => r.includes("borderline"))).toBe(true);
  });

  it("persistent borderline accepted only with an explicit note (surfaced in verdict)", () => {
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [
        {
          viewport: "desktop",
          outDir: scoreDir(goodScore({ stability: "borderline" })),
          acceptBorderlineNote: "re-ran once, still borderline: cursor blink in password field",
        },
      ],
    });
    expect(v.done).toBe(true);
    expect(v.viewports[0]?.borderlineNote).toContain("re-ran once");
  });

  it("borderline note does NOT rescue a failing run (pass=false stays not-done)", () => {
    const v = checkDoneGate({
      nodeId: NODE,
      viewports: [
        {
          viewport: "desktop",
          outDir: scoreDir(goodScore({ stability: "borderline", pass: false })),
          acceptBorderlineNote: "noted",
        },
      ],
    });
    expect(v.done).toBe(false);
  });
});
