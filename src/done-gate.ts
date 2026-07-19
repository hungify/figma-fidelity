/** Artifact-gated completion. Each viewport declares one exact Figma↔DOM contract. */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveArtifactPath } from "./paths.ts";
import type { ExpectSize, ProfileName } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export const DEFAULT_MAX_SCORE_AGE_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_GOLD_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000;

export interface DoneGateViewport {
  viewport: string;
  outDir: string;
  fileKey: string;
  nodeId: string;
  profile: ProfileName;
  selector?: string;
  expectSize?: ExpectSize;
}

export interface DoneGateOptions {
  viewports: DoneGateViewport[];
  maxScoreAgeMs?: number;
  now?: () => number;
  cwd?: string;
}

export interface ViewportVerdict {
  viewport: string;
  done: boolean;
  reasons: string[];
}

export interface DoneGateVerdict {
  schemaVersion: typeof SCHEMA_VERSION;
  done: boolean;
  viewports: ViewportVerdict[];
}

interface ScoreFile {
  schemaVersion?: number;
  pass?: boolean;
  runType?: string;
  capturedAt?: string;
  fileKey?: string;
  nodeId?: string | null;
  viewport?: string;
  profile?: string;
  pageReason?: string | null;
  selector?: string | null;
  expectSize?: ExpectSize | null;
  stability?: string;
  outDir?: string;
  gold?: {
    path?: string;
    metaPath?: string;
    fileKey?: string;
    nodeId?: string;
    fetchedAt?: string;
  };
  evidenceHashes?: {
    gold?: string;
    goldMeta?: string;
    actual?: string;
    diff?: string | null;
  };
  topIssues?: Array<{ kind?: string; severity?: string; message?: string }>;
}

export function checkDoneGate(options: DoneGateOptions): DoneGateVerdict {
  const maxAge = options.maxScoreAgeMs ?? DEFAULT_MAX_SCORE_AGE_MS;
  const now = options.now?.() ?? Date.now();
  const cwd = options.cwd ?? process.cwd();

  const viewports = options.viewports.map((contract): ViewportVerdict => {
    const reasons = validateContract(contract);
    const outDir = resolveArtifactPath(contract.outDir, cwd);
    const scorePath = path.join(outDir, "visual-score.json");
    if (!fs.existsSync(scorePath)) {
      reasons.push(`missing visual-score.json at ${scorePath}.`);
      return verdict(contract.viewport, reasons);
    }

    let score: ScoreFile;
    try {
      score = JSON.parse(fs.readFileSync(scorePath, "utf8")) as ScoreFile;
    } catch {
      reasons.push(`unreadable visual-score.json at ${scorePath}.`);
      return verdict(contract.viewport, reasons);
    }

    if (score.schemaVersion !== SCHEMA_VERSION) {
      reasons.push(`score schemaVersion must be ${SCHEMA_VERSION}.`);
    }
    if (score.pass !== true) reasons.push("pass is not true.");
    if (score.runType !== "final") reasons.push('runType must be "final".');
    if (score.fileKey !== contract.fileKey) reasons.push("fileKey does not match contract.");
    if (score.nodeId !== contract.nodeId) reasons.push("nodeId does not match contract.");
    if (score.viewport !== contract.viewport) reasons.push("viewport does not match contract.");
    if (score.profile !== contract.profile) reasons.push("profile does not match contract.");
    if (score.profile === "page" && !score.pageReason?.trim()) {
      reasons.push("page score missing pageReason.");
    }
    if ((score.selector ?? undefined) !== contract.selector) {
      reasons.push("selector does not match contract.");
    }
    if (!sameSize(score.expectSize, contract.expectSize)) {
      reasons.push("expectSize does not match contract.");
    }
    if (score.stability !== "stable") reasons.push('stability must be "stable".');
    if (!score.outDir || path.resolve(score.outDir) !== outDir) {
      reasons.push("score outDir does not match declared artifact directory.");
    }

    const residualBlock = score.topIssues?.some(
      (issue) =>
        issue.kind === "residual" && (issue.severity === "medium" || issue.severity === "high"),
    );
    if (residualBlock) reasons.push("blocking residual diff cluster remains.");

    const capturedAtMs = score.capturedAt ? Date.parse(score.capturedAt) : Number.NaN;
    if (!Number.isFinite(capturedAtMs)) {
      reasons.push("capturedAt missing/unparseable.");
    } else if (capturedAtMs > now + CLOCK_SKEW_MS) {
      reasons.push("capturedAt is in future.");
    } else if (now - capturedAtMs > maxAge) {
      reasons.push(`capturedAt older than ${Math.round(maxAge / 60000)}min.`);
    }

    const expectedGold = path.join(outDir, "figma-gold.png");
    const expectedGoldMeta = path.join(outDir, "figma-gold.meta.json");
    if (score.gold?.fileKey !== contract.fileKey || score.gold?.nodeId !== contract.nodeId) {
      reasons.push("gold evidence does not match fileKey/nodeId contract.");
    }
    if (score.gold?.path !== expectedGold || score.gold?.metaPath !== expectedGoldMeta) {
      reasons.push("gold evidence paths do not match contract directory.");
    }
    const goldFetchedAtMs = score.gold?.fetchedAt ? Date.parse(score.gold.fetchedAt) : Number.NaN;
    if (!Number.isFinite(goldFetchedAtMs)) {
      reasons.push("gold fetchedAt missing/unparseable.");
    } else if (goldFetchedAtMs > now + CLOCK_SKEW_MS) {
      reasons.push("gold fetchedAt is in future.");
    } else if (now - goldFetchedAtMs > DEFAULT_MAX_GOLD_AGE_MS) {
      reasons.push("gold older than 24h; re-run fidelity_fetch_gold.");
    } else if (Number.isFinite(capturedAtMs) && goldFetchedAtMs > capturedAtMs + CLOCK_SKEW_MS) {
      reasons.push("gold fetchedAt is later than capture.");
    }

    for (const name of [
      "figma-gold.png",
      "figma-gold.meta.json",
      "actual.png",
      "diff.png",
      "run-meta.json",
      "punch-list.json",
    ]) {
      if (!fs.existsSync(path.join(outDir, name))) reasons.push(`missing ${name}.`);
    }
    verifyGoldMeta(expectedGoldMeta, contract, score.gold?.fetchedAt, reasons);
    verifyEvidenceHashes(outDir, score, reasons);

    return verdict(contract.viewport, reasons);
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    done: viewports.every((viewport) => viewport.done),
    viewports,
  };
}

function validateContract(contract: DoneGateViewport): string[] {
  const reasons: string[] = [];
  if (!contract.fileKey || !contract.nodeId) reasons.push("fileKey/nodeId required.");
  if (contract.profile === "component/dev") {
    reasons.push("done gate forbids component/dev; use component/strict for final contract.");
  }
  if (contract.profile === "page") {
    if (contract.selector) reasons.push("page contract must not set selector.");
    if (contract.expectSize) reasons.push("page contract must not set expectSize.");
  } else {
    if (!contract.selector) reasons.push("component contract requires selector.");
    if (contract.profile === "component/strict" && !contract.expectSize) {
      reasons.push("component/strict contract requires expectSize.");
    }
  }
  return reasons;
}

function verifyGoldMeta(
  metaPath: string,
  contract: DoneGateViewport,
  expectedFetchedAt: string | undefined,
  reasons: string[],
): void {
  if (!fs.existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      fileKey?: string;
      nodeId?: string;
      fetchedAt?: string;
    };
    if (meta.fileKey !== contract.fileKey || meta.nodeId !== contract.nodeId) {
      reasons.push("figma-gold.meta.json does not match fileKey/nodeId contract.");
    }
    if (!expectedFetchedAt || meta.fetchedAt !== expectedFetchedAt) {
      reasons.push("gold fetchedAt evidence does not match figma-gold.meta.json.");
    }
  } catch {
    reasons.push("figma-gold.meta.json unreadable.");
  }
}

function verifyEvidenceHashes(outDir: string, score: ScoreFile, reasons: string[]): void {
  const files = {
    gold: "figma-gold.png",
    goldMeta: "figma-gold.meta.json",
    actual: "actual.png",
    diff: "diff.png",
  } as const;
  for (const key of Object.keys(files) as Array<keyof typeof files>) {
    const name = files[key];
    const filePath = path.join(outDir, name);
    if (!fs.existsSync(filePath)) continue;
    const actual = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex")}`;
    if (!score.evidenceHashes?.[key] || score.evidenceHashes[key] !== actual) {
      reasons.push(`${name} hash does not match score.`);
    }
  }
}

function sameSize(actual: ExpectSize | null | undefined, expected?: ExpectSize): boolean {
  if (!actual && !expected) return true;
  return actual?.width === expected?.width && actual?.height === expected?.height;
}

function verdict(viewport: string, reasons: string[]): ViewportVerdict {
  return { viewport, done: reasons.length === 0, reasons };
}
