/**
 * CHECKPOINT — case 1: Frame 27 (login card, node 153:5181, 544x464).
 *
 * Ground truth #1. Gold = real Figma Images API render (use_absolute_bounds),
 * fixtures = real app captures — never synthesized.
 *
 * - frame27-broken-actual.png: real capture of the reverted/broken login page
 *   (the exact "code wipe" bug class this engine exists to catch).
 * - frame27-good-actual.png: real app capture crop of the correct
 *   implementation (pre-wipe capture, cropped to Frame 27 bounds).
 *
 * SELECTOR_NOT_FOUND / SELECTOR_AMBIGUOUS are intentionally NOT tested here —
 * they are pure DOM-query checks covered by the shared DOM stubs in
 * selector-guard.test.ts (no PNG involvement, same category as the
 * PAGE_REASON_REQUIRED unit test).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { compare, validateScope } from "../src/index.ts";

const fixtures = path.join(import.meta.dirname, "fixtures");
const gold = path.join(fixtures, "frame27-figma-gold.png");
const EXPECT_SIZE = { width: 544, height: 464 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-case1-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("checkpoint case 1 — Frame 27", () => {
  it("gold fixture is the real Figma render at spec size 544x464", () => {
    expect(fs.existsSync(gold)).toBe(true);
  });

  it("FAIL: broken actual (post-wipe login) fails with size + expect-size issues", () => {
    const r = compare(gold, path.join(fixtures, "frame27-broken-actual.png"), tmp, {
      profile: "component/strict",
      expectSize: EXPECT_SIZE,
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.kind === "expect-size")).toBe(true);
    // Area gap (31%) short-circuits noisy downstream signals with one size issue.
    expect(r.topIssues.some((i) => i.kind === "size" && i.severity === "high")).toBe(true);
    expect(r.matchRatio).toBeNull();
  });

  it("good actual matches gold size (strict pass pending calibration)", () => {
    const r = compare(gold, path.join(fixtures, "frame27-good-actual.png"), tmp, {
      profile: "component/strict",
      expectSize: EXPECT_SIZE,
    });
    // Size lock holds; full strict pass is calibration debt (~1386 diff px today).
    expect(r.areaGapPercent).toBe(0);
    expect(r.matchRatio).toBeGreaterThan(0.99);
    expect(r.topIssues.every((i) => i.kind !== "expect-size")).toBe(true);
  });

  it("WRONG SCOPE: missing nodeId/selector → SCOPE_REQUIRED before any compare", () => {
    const r = validateScope({});
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe("SCOPE_REQUIRED");
  });
});
