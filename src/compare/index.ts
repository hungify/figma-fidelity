import * as path from "node:path";

import { getProfile } from "../profiles.ts";
import type { CompareOptions, CompareOutcome, TopIssue } from "../types.ts";
import { areaGap } from "./area-gap.ts";
import { avgDeltaE2000 } from "./delta-e.ts";
import { clusterFails, diffBoundingBox, pixelCompare } from "./pixel.ts";
import { padTo, readPng, writePng } from "./png.ts";
import { ssimCompare } from "./ssim.ts";

export { areaGap } from "./area-gap.ts";
export { avgDeltaE2000 } from "./delta-e.ts";
export { diffBoundingBox, pixelCompare, worstGridMatchRatio } from "./pixel.ts";
export { makeSolidPng, padTo, readPng, resizeNearest, writePng } from "./png.ts";
export { ssimCompare } from "./ssim.ts";

const EXPECT_SIZE_TOLERANCE_PX = 2;

/**
 * Multi-signal compare pipeline (align → area-gap pre-check → pixel → SSIM →
 * deltaE → cluster). Pure image-level: no capture, no guards — run() owns those.
 */
export function compare(
  goldPath: string,
  actualPath: string,
  outDir: string,
  options: CompareOptions,
): CompareOutcome {
  const profile = getProfile(options.profile);
  const gold = readPng(goldPath);
  const actual = readPng(actualPath);

  const topIssues: TopIssue[] = [];
  const warnings: string[] = [];

  if (options.expectSize) {
    const { width, height } = options.expectSize;
    const dw = Math.abs(actual.width - width);
    const dh = Math.abs(actual.height - height);
    if (dw > EXPECT_SIZE_TOLERANCE_PX || dh > EXPECT_SIZE_TOLERANCE_PX) {
      topIssues.push({
        severity: "high",
        kind: "expect-size",
        message: `actual is ${actual.width}x${actual.height}, expected ${width}x${height} (±${EXPECT_SIZE_TOLERANCE_PX}px)`,
        hint: "Check the captured element's CSS size against the Figma frame spec.",
      });
    }
  }

  // Area-gap pre-check: over threshold → downstream signals would measure size
  // skew, not content. Short-circuit with a single size issue instead.
  const gap = areaGap(gold, actual);
  if (gap.areaGapPercent > profile.maxAreaGapPercent) {
    topIssues.push({
      severity: "high",
      kind: "size",
      message:
        `bounding-box area gap ${gap.areaGapPercent.toFixed(2)}% exceeds ` +
        `${profile.maxAreaGapPercent}% (gold ${gap.goldSize.width}x${gap.goldSize.height}, ` +
        `actual ${gap.actualSize.width}x${gap.actualSize.height})`,
      hint: "Fix the element's rendered size first; pixel/SSIM/deltaE were skipped as they would only reflect the size skew.",
    });
    return {
      pass: false,
      fidelityScore: rankScore({ areaGapPercent: gap.areaGapPercent }),
      matchRatio: null,
      ssim: null,
      avgDeltaE: null,
      areaGapPercent: gap.areaGapPercent,
      clusterFail: false,
      diffPixels: null,
      totalPixels: null,
      goldSize: gap.goldSize,
      actualSize: gap.actualSize,
      resizedForCompare: false,
      topIssues,
      warnings,
      diffPath: null,
    };
  }

  // Align (pad, top-left anchor) so small size drifts stay visible as diffs.
  const width = Math.max(gold.width, actual.width);
  const height = Math.max(gold.height, actual.height);
  const resizedForCompare = gold.width !== actual.width || gold.height !== actual.height;
  const goldAligned = padTo(gold, width, height);
  const actualAligned = padTo(actual, width, height);

  const pixel = pixelCompare(goldAligned, actualAligned);
  const diffPath = path.join(outDir, "diff.png");
  writePng(diffPath, pixel.diff);

  const ssim = ssimCompare(goldAligned, actualAligned);

  // deltaE over the diff bbox so color error isn't diluted by matching chrome.
  // No pixel diffs ≠ no color drift (pixelmatch's YIQ threshold tolerates subtle
  // uniform recolors) → fall back to the full frame as the deltaE region.
  const bbox = diffBoundingBox(pixel.diff) ?? { x0: 0, y0: 0, x1: width, y1: height };
  const avgDeltaE = avgDeltaE2000(goldAligned, actualAligned, bbox);

  const clusterOn = options.clusterCheck ?? profile.cluster;
  const clusterFail =
    clusterOn && clusterFails(pixel.matchRatio, pixel.worstCellMatchRatio, profile.minMatch);

  if (pixel.matchRatio < profile.minMatch) {
    topIssues.push({
      severity: "high",
      kind: "pixel",
      message: `matchRatio ${(pixel.matchRatio * 100).toFixed(2)}% below ${(profile.minMatch * 100).toFixed(2)}% (${pixel.diffPixels}/${pixel.totalPixels} px differ)`,
      hint: "Inspect diff.png for red regions.",
    });
  }
  if (profile.maxDiffPixels !== null && pixel.diffPixels > profile.maxDiffPixels) {
    topIssues.push({
      severity: "high",
      kind: "pixel",
      message: `diffPixels ${pixel.diffPixels} exceeds budget ${profile.maxDiffPixels}`,
      hint: "Component-level budget: localize the change via diff.png.",
    });
  }
  if (ssim < profile.minSSIM) {
    topIssues.push({
      severity: "medium",
      kind: "ssim",
      message: `SSIM ${ssim.toFixed(4)} below ${profile.minSSIM} (structural mismatch: layout/spacing/shape)`,
    });
  }
  if (avgDeltaE > profile.maxAvgDeltaE) {
    topIssues.push({
      severity: "medium",
      kind: "color",
      message: `avg deltaE2000 ${avgDeltaE.toFixed(2)} over diff region exceeds ${profile.maxAvgDeltaE} (color/token mismatch)`,
      hint: "Check color tokens against Figma variables.",
    });
  }
  if (clusterFail) {
    topIssues.push({
      severity: "high",
      kind: "cluster",
      message: `worst 4x4 grid cell matchRatio ${(pixel.worstCellMatchRatio * 100).toFixed(2)}% — localized region is broken while the page average passes`,
      hint: "Full-page ratio is diluted; verify the failing region with a content-crop run.",
    });
  }

  // pass = per-signal threshold gates only (fidelityScore is NEVER a gate).
  const expectSizeFail = topIssues.some((i) => i.kind === "expect-size");
  const pass =
    !expectSizeFail &&
    pixel.matchRatio >= profile.minMatch &&
    (profile.maxDiffPixels === null || pixel.diffPixels <= profile.maxDiffPixels) &&
    ssim >= profile.minSSIM &&
    avgDeltaE <= profile.maxAvgDeltaE &&
    !clusterFail;

  return {
    pass,
    fidelityScore: rankScore({
      areaGapPercent: gap.areaGapPercent,
      matchRatio: pixel.matchRatio,
      ssim,
      avgDeltaE,
    }),
    matchRatio: pixel.matchRatio,
    ssim,
    avgDeltaE,
    areaGapPercent: gap.areaGapPercent,
    clusterFail,
    diffPixels: pixel.diffPixels,
    totalPixels: pixel.totalPixels,
    goldSize: gap.goldSize,
    actualSize: gap.actualSize,
    resizedForCompare,
    topIssues,
    warnings,
    diffPath,
  };
}

/**
 * Provisional weighted blend — RANK/SORT ONLY (punch-list ordering).
 * Never used as a pass gate until calibrated.
 */
function rankScore(signals: {
  areaGapPercent: number;
  matchRatio?: number;
  ssim?: number;
  avgDeltaE?: number;
}): number {
  const sizeScore = Math.max(0, 1 - signals.areaGapPercent / 100);
  if (signals.matchRatio === undefined) {
    // Short-circuited by area gap: only the size signal exists.
    return round4(0.5 * sizeScore);
  }
  const colorScore = 1 - Math.min(signals.avgDeltaE ?? 0, 10) / 10;
  return round4(
    0.45 * signals.matchRatio + 0.3 * (signals.ssim ?? 0) + 0.15 * colorScore + 0.1 * sizeScore,
  );
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
