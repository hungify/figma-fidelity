/**
 * Done gate — "done" is artifact-gated, per viewport, per stability.
 * The agent's claim is never the evidence; visual-score.json is.
 *
 * Known limitation (architectural): cannot stop an agent that ignores skill
 * instructions entirely — it verifies artifacts, not intent.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveArtifactPath } from "./paths.ts";

export const DEFAULT_MAX_SCORE_AGE_MS = 15 * 60 * 1000;

export interface DoneGateViewport {
  viewport: string;
  /** Directory containing this viewport's visual-score.json. */
  outDir: string;
  /**
   * Per-viewport Figma node. When set, overrides DoneGateOptions.nodeId for
   * this viewport (desktop content crop vs mobile full page, etc.).
   */
  nodeId?: string;
  /**
   * Accept a persistent borderline as final. Allowed only after ONE manual
   * re-run still came back borderline; the note is surfaced in the verdict and
   * must be included in the completion report.
   */
  acceptBorderlineNote?: string;
}

export interface DoneGateOptions {
  /**
   * Default expected nodeId for all viewports. Optional when every viewport
   * supplies its own `nodeId`.
   */
  nodeId?: string;
  viewports: DoneGateViewport[];
  /** How fresh capturedAt must be. Default 15 minutes. */
  maxScoreAgeMs?: number;
  now?: () => number;
  /** Base for relative outDir resolution (MCP cwd). Default process.cwd(). */
  cwd?: string;
}

export interface ViewportVerdict {
  viewport: string;
  done: boolean;
  reasons: string[];
  /** Set when a borderline run was accepted via acceptBorderlineNote. */
  borderlineNote?: string;
}

export interface DoneGateVerdict {
  done: boolean;
  viewports: ViewportVerdict[];
}

interface ScoreFile {
  pass?: boolean;
  runType?: string;
  capturedAt?: string;
  nodeId?: string | null;
  viewport?: string;
  stability?: string;
}

/**
 * Requirements per declared viewport, read from the CURRENT visual-score.json:
 * pass:true + runType:"final" + fresh capturedAt + matching nodeId +
 * stability:"stable" (borderline does not count as done for runType:final
 * unless explicitly accepted with a note after one manual re-run).
 * A missing viewport = not done.
 */
export function checkDoneGate(options: DoneGateOptions): DoneGateVerdict {
  const maxAge = options.maxScoreAgeMs ?? DEFAULT_MAX_SCORE_AGE_MS;
  const now = options.now?.() ?? Date.now();
  const cwd = options.cwd ?? process.cwd();

  const viewports = options.viewports.map((vp): ViewportVerdict => {
    const reasons: string[] = [];
    const expectedNodeId = vp.nodeId ?? options.nodeId;
    if (!expectedNodeId) {
      return {
        viewport: vp.viewport,
        done: false,
        reasons: [
          `no nodeId for viewport "${vp.viewport}" — set DoneGateOptions.nodeId or viewports[].nodeId.`,
        ],
      };
    }

    const outDir = resolveArtifactPath(vp.outDir, cwd);
    const scorePath = path.join(outDir, "visual-score.json");

    if (!fs.existsSync(scorePath)) {
      return {
        viewport: vp.viewport,
        done: false,
        reasons: [
          `missing visual-score.json at ${scorePath} — no artifact evidence for this viewport.`,
        ],
      };
    }

    let score: ScoreFile;
    try {
      score = JSON.parse(fs.readFileSync(scorePath, "utf8")) as ScoreFile;
    } catch {
      return {
        viewport: vp.viewport,
        done: false,
        reasons: [`unreadable visual-score.json at ${scorePath}.`],
      };
    }

    if (score.pass !== true) reasons.push("pass is not true.");
    if (score.runType !== "final") {
      reasons.push(
        `runType is "${score.runType ?? "missing"}" — done requires a fresh runType:"final" run.`,
      );
    }
    if (score.nodeId !== expectedNodeId) {
      reasons.push(
        `nodeId "${score.nodeId ?? "missing"}" does not match expected "${expectedNodeId}".`,
      );
    }
    if (score.viewport !== vp.viewport) {
      reasons.push(
        `score viewport "${score.viewport ?? "missing"}" does not match declared "${vp.viewport}".`,
      );
    }

    const capturedAtMs = score.capturedAt ? Date.parse(score.capturedAt) : Number.NaN;
    if (!Number.isFinite(capturedAtMs)) {
      reasons.push(
        "capturedAt missing/unparseable — stale score without fresh capture is invalid.",
      );
    } else if (now - capturedAtMs > maxAge) {
      reasons.push(
        `capturedAt ${score.capturedAt} is older than ${Math.round(maxAge / 60000)}min — re-run before reporting done.`,
      );
    }

    let borderlineNote: string | undefined;
    if (score.stability !== "stable") {
      if (score.stability === "borderline" && vp.acceptBorderlineNote?.trim()) {
        borderlineNote = vp.acceptBorderlineNote.trim();
      } else {
        reasons.push(
          `stability is "${score.stability ?? "missing"}" — borderline does not count as done for runType:final (one manual re-run permitted; accepting a persistent borderline requires an explicit note).`,
        );
      }
    }

    return { viewport: vp.viewport, done: reasons.length === 0, reasons, borderlineNote };
  });

  return { done: viewports.every((v) => v.done), viewports };
}
