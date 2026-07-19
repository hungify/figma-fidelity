export { capture } from "./capture.ts";
export type { CaptureOptions, CaptureOutcome, CaptureSuccess } from "./capture.ts";
export {
  areaGap,
  avgDeltaE2000,
  compare,
  compositeOnCanvas,
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  makeSolidPng,
  padTo,
  parseHexRgb,
  pixelCompare,
  readPng,
  resizeNearest,
  ssimCompare,
  worstGridMatchRatio,
  writePng,
} from "./compare/index.ts";
export { checkDoneGate, DEFAULT_MAX_GOLD_AGE_MS, DEFAULT_MAX_SCORE_AGE_MS } from "./done-gate.ts";
export type {
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ViewportVerdict,
} from "./done-gate.ts";
export { fetchGold, goldMetaPath, readGoldMeta, resolveToken } from "./fetch-gold.ts";
export type { FetchGoldOptions, FetchGoldOutcome, GoldMeta } from "./fetch-gold.ts";
export { loadNearestEnv } from "./load-env.ts";
export { resolveArtifactPath } from "./paths.ts";
export { checkGoldStaleness, DEFAULT_MAX_GOLD_AGE_DAYS } from "./staleness.ts";
export type { StalenessOptions } from "./staleness.ts";
export { getProfile, PROFILES } from "./profiles.ts";
export type { Profile } from "./profiles.ts";
export { run } from "./run.ts";
export { createFidelityMcpServer, startMcpServer } from "./mcp.ts";
export {
  ALL_AGENTS,
  buildServerEntry,
  detectClients,
  setupAgents,
  upsertTomlSection,
  wrapNpx,
} from "./setup.ts";
export type {
  AgentId,
  DetectedClient,
  LaunchMode,
  SetupOptions,
  SetupResult,
  SetupTargetResult,
  StdioServerEntry,
} from "./setup.ts";
export { specGate, specSizeTolerance } from "./spec/gate.ts";
export type { SpecGateInput, SpecGateOutcome } from "./spec/gate.ts";
export { resolveProfile, validateScope } from "./scope.ts";
export type { ScopeInput } from "./scope.ts";
export { assessStability } from "./stability.ts";
export type { StabilityAssessment } from "./stability.ts";
export { SCHEMA_VERSION } from "./types.ts";
export type {
  CompareOptions,
  CompareOutcome,
  ExpectSize,
  FidelityErrorCode,
  FidelityResult,
  GoldEvidence,
  ProfileName,
  RejectResult,
  RunArtifacts,
  RunEvidenceHashes,
  RunOptions,
  RunResult,
  RunType,
  Stability,
  TopIssue,
  TopIssueKind,
  TopIssueSeverity,
} from "./types.ts";
