import * as fs from "node:fs";
import * as path from "node:path";

import { capture } from "./capture.ts";
import { compare } from "./compare/index.ts";
import { readGoldMeta } from "./fetch-gold.ts";
import { getProfile } from "./profiles.ts";
import { writeArtifacts } from "./report.ts";
import { resolveProfile, validateScope } from "./scope.ts";
import { specGate } from "./spec/gate.ts";
import { assessStability } from "./stability.ts";
import { checkGoldStaleness } from "./staleness.ts";
import type { FidelityResult, RunOptions, RunResult } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

/**
 * Fresh, guarded fidelity run:
 *
 * 1. Guards (in order, before ANY capture/compare):
 *    SCOPE_REQUIRED → PAGE_REASON_REQUIRED → SELECTOR_NOT_FOUND → SELECTOR_AMBIGUOUS
 * 2. Fresh capture (never reuses an existing actual.png) + stability samples
 * 3. Multi-signal compare (area-gap pre-check → pixel → SSIM → deltaE → cluster)
 * 4. Stability tag + artifacts (visual-score.json / run-meta.json / punch-list.json)
 *
 * Gold must already exist on disk — fetch-gold is a separate command and its
 * failures never propagate here.
 */
export async function run(options: RunOptions): Promise<FidelityResult> {
  // Guards 1–2 (pure input).
  const scopeReject = validateScope(options);
  if (scopeReject) return scopeReject;

  const profileName = resolveProfile(options);
  const profile = getProfile(profileName);
  const runType = options.runType ?? "dev";
  const pageEscapeWarnings = warnPageEscape(options, profileName);

  if (!fs.existsSync(options.goldPath)) {
    throw new Error(
      `Gold not found on disk: ${options.goldPath}. Run fetch-gold first (fetch-gold failures never fail fidelity_run; run simply requires gold to exist).`,
    );
  }

  const outDir = options.outDir;
  const actualPath = path.join(outDir, "actual.png");
  const samples = options.stabilitySamples ?? (runType === "final" ? 3 : 1);

  // Guards 3–4 run inside capture (need the rendered DOM), before any screenshot.
  const captured = await capture({
    url: options.url,
    outPath: actualPath,
    viewportSize: options.viewportSize,
    selector: options.selector,
    fullPage: profileName === "page",
    samples,
    timeoutMs: options.timeoutMs,
  });
  if ("error" in captured) return captured;

  const compareOutcome = compare(options.goldPath, actualPath, outDir, {
    profile: profileName,
    expectSize: options.expectSize,
  });

  const stability = assessStability(captured.capturePaths, profile.stabilityMaxDiffRatio);
  // Extra stability samples live in tmp — drop after assessment (artifact dir stays clean).
  for (const p of captured.ephemeralSamplePaths) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  if (captured.ephemeralSamplePaths.length > 0) {
    const dir = path.dirname(captured.ephemeralSamplePaths[0]!);
    try {
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
  // Warning-only; staleness/network problems never fail a run.
  const stalenessWarnings = await checkGoldStaleness(options.goldPath);
  const warnings = [
    ...pageEscapeWarnings,
    ...captured.warnings,
    ...compareOutcome.warnings,
    ...stalenessWarnings,
  ];
  const topIssues = [...compareOutcome.topIssues];
  let pass = compareOutcome.pass;

  // Spec gate: live DOM box vs CURRENT Figma spec. Hard-fail on mismatch;
  // any skip reason (page profile, no token, network) is a warning only.
  if (profileName !== "page" && options.nodeId) {
    const goldMeta = readGoldMeta(options.goldPath);
    if (!goldMeta) {
      warnings.push("spec-gate skipped: gold has no figma-gold.meta.json sidecar (no fileKey).");
    } else if (!captured.elementRect) {
      warnings.push("spec-gate skipped: no selector element measurement available.");
    } else {
      const spec = await specGate({
        fileKey: goldMeta.fileKey,
        nodeId: options.nodeId,
        domSize: captured.elementRect,
      });
      warnings.push(...spec.warnings);
      topIssues.push(...spec.topIssues);
      if (spec.pass === false) pass = false;
    }
  }
  if (samples < 2) {
    warnings.push(
      `stability not sampled (samples=${samples}); use runType:"final" or stabilitySamples>=2 for a real stability check.`,
    );
  }

  const result: RunResult = {
    schemaVersion: SCHEMA_VERSION,
    ok: true,
    pass,
    runType,
    viewport: options.viewport,
    profile: profileName,
    pageReason: options.pageReason ?? null,
    nodeId: options.nodeId ?? null,
    selector: options.selector ?? null,
    fidelityScore: compareOutcome.fidelityScore,
    matchRatio: compareOutcome.matchRatio,
    ssim: compareOutcome.ssim,
    avgDeltaE: compareOutcome.avgDeltaE,
    areaGapPercent: compareOutcome.areaGapPercent,
    clusterFail: compareOutcome.clusterFail,
    stability: stability.stability,
    capturedAt: captured.capturedAt,
    outDir,
    artifacts: {
      score: path.join(outDir, "visual-score.json"),
      diff: compareOutcome.diffPath,
      punchList: path.join(outDir, "punch-list.json"),
      meta: path.join(outDir, "run-meta.json"),
    },
    topIssues,
    warnings,
  };

  writeArtifacts({
    result,
    compareOutcome,
    stability,
    options,
    goldPath: options.goldPath,
    actualPath,
  });

  return result;
}

/** Heuristic: profile=page used to dodge content-crop / alpha / shadow. */
const PAGE_ESCAPE_RE =
  /\b(alpha|transparenc|shadow|bleed|soft.?shadow|drop.?shadow|escape|dilut|full.?page.?ok|content.?crop|figma-gold-content)\b/i;

function warnPageEscape(
  options: RunOptions,
  profileName: string,
): string[] {
  if (profileName !== "page") return [];
  const out: string[] = [];
  if (options.expectSize) {
    out.push(
      "profile=page with expectSize — prefer component/strict + content-crop selector; full-page dilutes local CTA/icon diffs.",
    );
  }
  const reason = options.pageReason ?? "";
  if (PAGE_ESCAPE_RE.test(reason)) {
    out.push(
      `pageReason suggests content-crop dodge ("${reason.slice(0, 120)}"). Prefer component/strict + unique selector over profile=page.`,
    );
  }
  return out;
}
