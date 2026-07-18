import type { PNG } from "pngjs";

export interface AreaGapResult {
  /** Percent difference of bounding-box areas: |actual - gold| / gold * 100. */
  areaGapPercent: number;
  goldSize: { width: number; height: number };
  actualSize: { width: number; height: number };
}

/**
 * Early pre-check — runs right after align, before pixelmatch/SSIM/deltaE.
 * A large size gap means downstream signals are noise (measuring size skew,
 * not content), so the pipeline short-circuits with a "size" topIssue.
 */
export function areaGap(gold: PNG, actual: PNG): AreaGapResult {
  const goldArea = gold.width * gold.height;
  const actualArea = actual.width * actual.height;
  const areaGapPercent = goldArea === 0 ? 100 : (Math.abs(actualArea - goldArea) / goldArea) * 100;
  return {
    areaGapPercent,
    goldSize: { width: gold.width, height: gold.height },
    actualSize: { width: actual.width, height: actual.height },
  };
}
