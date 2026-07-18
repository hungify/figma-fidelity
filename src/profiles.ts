/**
 * ============================================================================
 * HUMAN-REVIEW ONLY. Never edit thresholds to force a pass.
 *
 * Threshold changes require a human decision and a note in the commit message
 * (see .githooks/pre-commit). Agents: when a run fails, fix the code under
 * verify — do not touch this file.
 *
 * Status: PROVISIONAL — pending calibration (calibrate-thresholds step).
 * ============================================================================
 */
import type { ProfileName } from "./types.ts";

export interface Profile {
  name: ProfileName;
  /** Minimum global pixel matchRatio (1 - diffPixels/totalPixels). */
  minMatch: number;
  /** Absolute diff-pixel budget. null = unset. */
  maxDiffPixels: number | null;
  /** Minimum mean SSIM. */
  minSSIM: number;
  /** Maximum average CIEDE2000 over the diff bounding box. */
  maxAvgDeltaE: number;
  /** Max bounding-box area gap (percent) between actual and gold; checked BEFORE pixel/SSIM/deltaE. */
  maxAreaGapPercent: number;
  /** 4x4 grid worst-cell check (page profile only; ships after checkpoints). */
  cluster: boolean;
  /** Max pixel diff-ratio between repeat captures before run is tagged "borderline". */
  stabilityMaxDiffRatio: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  page: {
    name: "page",
    minMatch: 0.99,
    maxDiffPixels: null,
    minSSIM: 0.97,
    maxAvgDeltaE: 4.0,
    maxAreaGapPercent: 5,
    cluster: true,
    stabilityMaxDiffRatio: 0.002,
  },
  "component/strict": {
    name: "component/strict",
    minMatch: 0.995,
    maxDiffPixels: 500,
    minSSIM: 0.985,
    maxAvgDeltaE: 3.0,
    maxAreaGapPercent: 2,
    cluster: false,
    stabilityMaxDiffRatio: 0.002,
  },
  "component/dev": {
    name: "component/dev",
    minMatch: 0.98,
    maxDiffPixels: 2000,
    minSSIM: 0.96,
    maxAvgDeltaE: 5.0,
    maxAreaGapPercent: 5,
    cluster: false,
    stabilityMaxDiffRatio: 0.002,
  },
};

export function getProfile(name: ProfileName): Profile {
  return PROFILES[name];
}
