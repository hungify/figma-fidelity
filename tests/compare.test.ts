import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { compare, makeSolidPng, writePng } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-compare-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function write(png: PNG, name: string): string {
  const p = path.join(tmp, `${n++}-${name}.png`);
  writePng(p, png);
  return p;
}

function outDir(): string {
  const p = path.join(tmp, `out-${n++}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Solid image with a recolored rectangle. */
function withRect(
  base: PNG,
  rect: { x: number; y: number; w: number; h: number },
  rgba: [number, number, number, number],
): PNG {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (base.width * y + x) << 2;
      base.data[i] = rgba[0];
      base.data[i + 1] = rgba[1];
      base.data[i + 2] = rgba[2];
      base.data[i + 3] = rgba[3];
    }
  }
  return base;
}

describe("compare pipeline", () => {
  it("passes on identical images", () => {
    const gold = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "gold");
    const actual = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "actual");
    const dir = outDir();
    const r = compare(gold, actual, dir, { profile: "component/strict" });
    expect(r.pass).toBe(true);
    expect(r.matchRatio).toBe(1);
    expect(r.areaGapPercent).toBe(0);
    expect(r.topIssues).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, "diff.png"))).toBe(true);
  });

  it("fails on a broken region (pixel + budget)", () => {
    const gold = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "gold");
    const broken = withRect(
      makeSolidPng(200, 100, [240, 240, 240, 255]),
      {
        x: 20,
        y: 20,
        w: 100,
        h: 50,
      },
      [200, 30, 30, 255],
    );
    const actual = write(broken, "actual");
    const r = compare(gold, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.kind === "pixel")).toBe(true);
  });

  it("area-gap over threshold short-circuits downstream signals with a size topIssue", () => {
    const gold = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "gold");
    // 200x100=20000 vs 240x120=28800 → 44% gap, way over 2%
    const actual = write(makeSolidPng(240, 120, [240, 240, 240, 255]), "actual");
    const r = compare(gold, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(false);
    expect(r.areaGapPercent).toBeGreaterThan(2);
    // Short-circuit: downstream signals skipped, no noisy pixel/ssim failures.
    expect(r.matchRatio).toBeNull();
    expect(r.ssim).toBeNull();
    expect(r.avgDeltaE).toBeNull();
    expect(r.diffPath).toBeNull();
    expect(r.topIssues).toHaveLength(1);
    expect(r.topIssues[0]?.kind).toBe("size");
    expect(r.topIssues[0]?.severity).toBe("high");
  });

  it("small size drift under areaGap threshold still compares (pad align)", () => {
    const gold = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "gold");
    // 201x100 → 0.5% gap, under 2% → pipeline continues; pad strip counts as diff
    const actual = write(makeSolidPng(201, 100, [240, 240, 240, 255]), "actual");
    const r = compare(gold, actual, outDir(), { profile: "component/strict" });
    expect(r.matchRatio).not.toBeNull();
    expect(r.resizedForCompare).toBe(true);
  });

  it("expect-size mismatch fails even when images match", () => {
    const gold = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "gold");
    const actual = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "actual");
    const r = compare(gold, actual, outDir(), {
      profile: "component/strict",
      expectSize: { width: 544, height: 464 },
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.kind === "expect-size")).toBe(true);
  });

  it("pass is derived from per-signal thresholds only — fidelityScore is rank-only", () => {
    const gold = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "gold");
    const actual = write(makeSolidPng(200, 100, [240, 240, 240, 255]), "actual");
    const r = compare(gold, actual, outDir(), { profile: "component/strict" });
    // fidelityScore exists for ranking but pass must hold regardless of its value.
    expect(typeof r.fidelityScore).toBe("number");
    expect(r.pass).toBe(true);

    const broken = withRect(
      makeSolidPng(200, 100, [240, 240, 240, 255]),
      {
        x: 0,
        y: 0,
        w: 200,
        h: 60,
      },
      [10, 10, 10, 255],
    );
    const badActual = write(broken, "bad");
    const bad = compare(gold, badActual, outDir(), { profile: "component/strict" });
    expect(bad.pass).toBe(false);
    // Even a numerically "high" blended score can never flip pass.
    expect(bad.topIssues.length).toBeGreaterThan(0);
  });

  it("flags color mismatch via deltaE on subtle recolor", () => {
    const gold = write(makeSolidPng(200, 100, [50, 120, 220, 255]), "gold");
    const actual = write(makeSolidPng(200, 100, [50, 170, 120, 255]), "actual");
    const r = compare(gold, actual, outDir(), { profile: "component/strict" });
    expect(r.pass).toBe(false);
    expect(r.avgDeltaE).not.toBeNull();
    expect(r.avgDeltaE as number).toBeGreaterThan(3);
  });

  it("pass=true with residual red still warns (kind=residual)", () => {
    // Sparse red pixels: page match/SSIM/deltaE still pass (diluted), but red remains.
    const goldPng = makeSolidPng(800, 600, [240, 240, 240, 255]);
    const hot = makeSolidPng(800, 600, [240, 240, 240, 255]);
    let n = 0;
    for (let y = 0; y < 600 && n < 100; y += 60) {
      for (let x = 0; x < 800 && n < 100; x += 80) {
        const i = (800 * y + x) << 2;
        hot.data[i] = 200;
        hot.data[i + 1] = 30;
        hot.data[i + 2] = 30;
        hot.data[i + 3] = 255;
        n += 1;
      }
    }
    const gold = write(goldPng, "gold");
    const actual = write(hot, "actual");
    const r = compare(gold, actual, outDir(), { profile: "page" });
    expect(r.pass).toBe(true);
    expect(r.warnings.some((w) => w.includes("residual"))).toBe(true);
    expect(r.topIssues.some((i) => i.kind === "residual")).toBe(true);
  });
});
