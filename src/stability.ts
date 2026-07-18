import { pixelCompare } from "./compare/pixel.ts";
import { padTo, readPng } from "./compare/png.ts";
import type { Stability } from "./types.ts";

export interface StabilityAssessment {
  stability: Stability;
  /** Worst pixel diff-ratio observed between the first capture and any sample. */
  maxObservedDiffRatio: number;
  samples: number;
}

/**
 * Variance across repeat captures of the SAME actual.
 * borderline never flips pass/fail — it only blocks the done-gate for
 * runType:final (agent may manually re-run once; no auto-retry in core).
 */
export function assessStability(capturePaths: string[], maxDiffRatio: number): StabilityAssessment {
  if (capturePaths.length < 2) {
    return { stability: "stable", maxObservedDiffRatio: 0, samples: capturePaths.length };
  }

  const first = readPng(capturePaths[0] as string);
  let maxObserved = 0;

  for (const samplePath of capturePaths.slice(1)) {
    const sample = readPng(samplePath);
    const width = Math.max(first.width, sample.width);
    const height = Math.max(first.height, sample.height);
    const a = padTo(first, width, height);
    const b = padTo(sample, width, height);
    const { diffPixels, totalPixels } = pixelCompare(a, b);
    const ratio = totalPixels === 0 ? 1 : diffPixels / totalPixels;
    if (ratio > maxObserved) maxObserved = ratio;
  }

  return {
    stability: maxObserved <= maxDiffRatio ? "stable" : "borderline",
    maxObservedDiffRatio: maxObserved,
    samples: capturePaths.length,
  };
}
