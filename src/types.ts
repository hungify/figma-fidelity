export const SCHEMA_VERSION = 1 as const;

export type ProfileName = "page" | "component/strict" | "component/dev";

export type RunType = "dev" | "final";

export type Stability = "stable" | "borderline";

export type FidelityErrorCode =
  | "SCOPE_REQUIRED"
  | "PAGE_REASON_REQUIRED"
  | "SELECTOR_NOT_FOUND"
  | "SELECTOR_AMBIGUOUS";

export type TopIssueKind =
  | "size"
  | "expect-size"
  | "pixel"
  | "ssim"
  | "color"
  | "cluster"
  | "spec-size-mismatch"
  /** Pass thresholds met, but real red diffs remain — inspect diff.png. */
  | "residual";

export type TopIssueSeverity = "high" | "medium" | "low";

export interface TopIssue {
  severity: TopIssueSeverity;
  kind: TopIssueKind;
  message: string;
  hint?: string;
}

/** Config-error reject body. Exit 2 territory. Emitted before any capture/compare. */
export interface RejectResult {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: false;
  error: FidelityErrorCode;
  message: string;
  matchCount?: number;
}

export interface RunArtifacts {
  score: string;
  diff: string | null;
  punchList: string;
  meta: string;
}

/** Success/fail body (fidelity verdict — distinct from config-error rejects). */
export interface RunResult {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: true;
  pass: boolean;
  runType: RunType;
  viewport: string;
  profile: ProfileName;
  pageReason: string | null;
  nodeId: string | null;
  selector: string | null;
  /** Rank-only weighted blend. NEVER a gate until calibrated. */
  fidelityScore: number;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  areaGapPercent: number;
  clusterFail: boolean;
  stability: Stability;
  capturedAt: string;
  outDir: string;
  artifacts: RunArtifacts;
  topIssues: TopIssue[];
  warnings: string[];
}

export type FidelityResult = RunResult | RejectResult;

export interface ExpectSize {
  width: number;
  height: number;
}

export interface CompareOptions {
  profile: ProfileName;
  /** Bounding-box size the actual must satisfy (e.g. Frame 27 = 544x464). */
  expectSize?: ExpectSize;
  /** Skip cluster check even for page profile (cluster ships after checkpoints). */
  clusterCheck?: boolean;
}

export interface CompareOutcome {
  pass: boolean;
  fidelityScore: number;
  matchRatio: number | null;
  ssim: number | null;
  avgDeltaE: number | null;
  areaGapPercent: number;
  clusterFail: boolean;
  diffPixels: number | null;
  totalPixels: number | null;
  goldSize: { width: number; height: number };
  actualSize: { width: number; height: number };
  resizedForCompare: boolean;
  topIssues: TopIssue[];
  warnings: string[];
  /** Written diff.png path, null when short-circuited by area-gap. */
  diffPath: string | null;
}

export interface RunOptions {
  /** URL of the rendered app (dev server or preview). */
  url: string;
  /** Figma node id being verified (e.g. "153:5181"). Required unless selector-only component verify. */
  nodeId?: string;
  /** CSS selector isolating the content under verify. Must resolve to exactly 1 element. */
  selector?: string;
  /** Required. e.g. "desktop" | "mobile". */
  viewport: string;
  /** Viewport pixel size for the browser page. */
  viewportSize: { width: number; height: number };
  /** Defaults to component/strict when nodeId/selector present. page must be explicit. */
  profile?: ProfileName;
  /** Required when profile === "page". */
  pageReason?: string;
  runType?: RunType;
  /** Gold PNG path on disk. fetch-gold failures never propagate here. */
  goldPath: string;
  outDir: string;
  expectSize?: ExpectSize;
  /** Number of captures for the stability check. Default 3 for final, 1 for dev. */
  stabilitySamples?: number;
  timeoutMs?: number;
}
