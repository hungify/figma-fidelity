import * as fs from "node:fs";
import * as path from "node:path";

import type { StabilityAssessment } from "./stability.ts";
import type { CompareOutcome, RunOptions, RunResult } from "./types.ts";

export interface ReportInput {
  result: RunResult;
  compareOutcome: CompareOutcome;
  stability: StabilityAssessment;
  options: RunOptions;
  goldPath: string;
  actualPath: string;
}

/**
 * Writes visual-score.json / run-meta.json / punch-list.json.
 * visual-score.json is the done-gate artifact: pass + capturedAt + runType +
 * nodeId + viewport + stability must all be readable from it.
 * No token/credential value ever appears in any artifact.
 */
export function writeArtifacts(input: ReportInput): void {
  const { result, compareOutcome, stability, options } = input;
  fs.mkdirSync(result.outDir, { recursive: true });

  const score = {
    ...result,
    diffPixels: compareOutcome.diffPixels,
    totalPixels: compareOutcome.totalPixels,
    goldSize: compareOutcome.goldSize,
    actualSize: compareOutcome.actualSize,
    resizedForCompare: compareOutcome.resizedForCompare,
    stabilityDetail: {
      samples: stability.samples,
      maxObservedDiffRatio: stability.maxObservedDiffRatio,
    },
  };
  fs.writeFileSync(result.artifacts.score, `${JSON.stringify(score, null, 2)}\n`);

  const runMeta = {
    schemaVersion: result.schemaVersion,
    url: options.url,
    fileKey: result.fileKey,
    nodeId: result.nodeId,
    selector: result.selector,
    viewport: result.viewport,
    viewportSize: options.viewportSize,
    profile: result.profile,
    pageReason: result.pageReason,
    runType: result.runType,
    expectSize: result.expectSize,
    gold: result.gold,
    actualPath: path.resolve(input.actualPath),
    capturedAt: result.capturedAt,
    stability: result.stability,
    stabilitySamples: stability.samples,
    warnings: result.warnings,
  };
  fs.writeFileSync(result.artifacts.meta, `${JSON.stringify(runMeta, null, 2)}\n`);

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  const punchList = {
    schemaVersion: result.schemaVersion,
    fidelityScore: result.fidelityScore,
    pass: result.pass,
    items: [...result.topIssues].sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity],
    ),
  };
  fs.writeFileSync(result.artifacts.punchList, `${JSON.stringify(punchList, null, 2)}\n`);
}
