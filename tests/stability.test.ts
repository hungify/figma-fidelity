import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";

import { assessStability, makeSolidPng, writePng } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-stability-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function write(png: PNG): string {
  const p = path.join(tmp, `s-${n++}.png`);
  writePng(p, png);
  return p;
}

describe("stability check", () => {
  it("identical repeat captures → stable", () => {
    const a = write(makeSolidPng(100, 100, [200, 200, 200, 255]));
    const b = write(makeSolidPng(100, 100, [200, 200, 200, 255]));
    const c = write(makeSolidPng(100, 100, [200, 200, 200, 255]));
    const r = assessStability([a, b, c], 0.002);
    expect(r.stability).toBe("stable");
    expect(r.maxObservedDiffRatio).toBe(0);
    expect(r.samples).toBe(3);
  });

  it("variance over threshold → borderline (never auto-retried)", () => {
    const a = write(makeSolidPng(100, 100, [200, 200, 200, 255]));
    const flicker = makeSolidPng(100, 100, [200, 200, 200, 255]);
    for (let i = 0; i < 100; i++) {
      // 1% of pixels flip — over the 0.2% variance budget
      const o = i << 2;
      flicker.data[o] = 0;
      flicker.data[o + 1] = 0;
      flicker.data[o + 2] = 0;
    }
    const b = write(flicker);
    const r = assessStability([a, b], 0.002);
    expect(r.stability).toBe("borderline");
    expect(r.maxObservedDiffRatio).toBeGreaterThan(0.002);
  });

  it("single capture → stable with 1 sample (run() adds a warning)", () => {
    const a = write(makeSolidPng(50, 50, [10, 10, 10, 255]));
    const r = assessStability([a], 0.002);
    expect(r.stability).toBe("stable");
    expect(r.samples).toBe(1);
  });
});
