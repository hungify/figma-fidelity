import { resolveToken } from "../fetch-gold.ts";
/**
 * Spec gate — Figma REST spec size ↔ DOM measured size, HARD-fail on mismatch.
 *
 * Distinct from the compare pipeline's areaGap:
 * - areaGap compares two captured PNGs (render-level drift, every run).
 * - spec-gate compares the LIVE DOM box (getBoundingClientRect at capture
 *   time, DPR=1) against the CURRENT Figma spec (absoluteBoundingBox via REST)
 *   — catches "code no longer matches Figma's latest spec" even when the gold
 *   PNG on disk is stale.
 *
 * Skips (warning, never blocks the visual verdict):
 * - page profile (no single node to compare)
 * - missing token / missing nodeId / missing DOM measurement
 * - any network/REST error
 */
import { getNodeMetadata } from "../figma-api.ts";
import type { TopIssue } from "../types.ts";

export interface SpecGateInput {
  fileKey: string;
  nodeId: string;
  /** CSS-pixel border-box size of the verified element (DPR=1 capture). */
  domSize: { width: number; height: number };
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface SpecGateOutcome {
  /** null = skipped (see warnings); true/false = evaluated. */
  pass: boolean | null;
  topIssues: TopIssue[];
  warnings: string[];
}

/** Structural/CSS check → much tighter than areaGap: max(2px, 0.5%) per axis. */
export function specSizeTolerance(figmaSize: number): number {
  return Math.max(2, figmaSize * 0.005);
}

export async function specGate(input: SpecGateInput): Promise<SpecGateOutcome> {
  const warnings: string[] = [];
  const token = resolveToken(input.token);
  if (!token) {
    return {
      pass: null,
      topIssues: [],
      warnings: ["spec-gate skipped: no Figma token to fetch the current node spec."],
    };
  }

  const meta = await getNodeMetadata(input.fileKey, input.nodeId, token, input.fetchImpl);
  if ("error" in meta) {
    return {
      pass: null,
      topIssues: [],
      warnings: [
        `spec-gate skipped for this run (${meta.error}) — visual verdict already computed against gold on disk.`,
      ],
    };
  }
  if (!meta.absoluteBoundingBox) {
    return {
      pass: null,
      topIssues: [],
      warnings: ["spec-gate skipped: node has no absoluteBoundingBox in Figma metadata."],
    };
  }

  const spec = meta.absoluteBoundingBox;
  const topIssues: TopIssue[] = [];
  const dw = Math.abs(input.domSize.width - spec.width);
  const dh = Math.abs(input.domSize.height - spec.height);

  if (dw > specSizeTolerance(spec.width) || dh > specSizeTolerance(spec.height)) {
    topIssues.push({
      severity: "high",
      kind: "spec-size-mismatch",
      message:
        `DOM element is ${input.domSize.width}x${input.domSize.height} but Figma spec ` +
        `(node ${input.nodeId}) says ${spec.width}x${spec.height} ` +
        `(tolerance max(2px, 0.5%)) — code does not match the CURRENT Figma spec.`,
      hint: "Check width/height/padding/margin/box-sizing; this is structural, distinct from render-level areaGap.",
    });
  }

  return { pass: topIssues.length === 0, topIssues, warnings };
}
