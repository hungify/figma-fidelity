import { readGoldMeta, resolveToken } from "./fetch-gold.ts";
/**
 * Gold staleness check — ALWAYS warnings, never hard-fail.
 * Independent from fetch-gold error handling: a failure to re-check freshness
 * never fails fidelity_run.
 */
import { getNodeMetadata } from "./figma-api.ts";

export const DEFAULT_MAX_GOLD_AGE_DAYS = 14;

export interface StalenessOptions {
  /** Token override; defaults to FIGMA_ACCESS_TOKEN env. */
  token?: string;
  maxAgeDays?: number;
  fetchImpl?: typeof fetch;
}

/**
 * With a token: re-check Figma's current lastModified vs the value stored at
 * fetch time (real change detection). Without: time-based heuristic only —
 * warns when fetchedAt is older than maxAgeDays (does NOT detect real Figma
 * changes; it is a periodic re-fetch reminder).
 */
export async function checkGoldStaleness(
  goldPath: string,
  options: StalenessOptions = {},
): Promise<string[]> {
  const warnings: string[] = [];
  const meta = readGoldMeta(goldPath);
  if (!meta) {
    warnings.push(
      "gold has no figma-gold.meta.json sidecar; freshness unknown — re-fetch gold to start tracking staleness.",
    );
    return warnings;
  }

  const token = resolveToken(options.token);
  if (token) {
    const current = await getNodeMetadata(meta.fileKey, meta.nodeId, token, options.fetchImpl);
    if ("error" in current) {
      warnings.push(
        `gold staleness re-check failed (${current.error}); falling back to time-based heuristic.`,
      );
    } else {
      if (current.lastModified && meta.lastModified && current.lastModified !== meta.lastModified) {
        warnings.push(
          `gold may be stale: Figma file lastModified ${current.lastModified} differs from gold fetch-time value ${meta.lastModified}; re-run fetch-gold.`,
        );
      }
      return warnings;
    }
  }

  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_GOLD_AGE_DAYS;
  const ageMs = Date.now() - Date.parse(meta.fetchedAt);
  const ageDays = Math.floor(ageMs / 86_400_000);
  if (ageDays > maxAgeDays) {
    warnings.push(
      `gold not re-verified in ${ageDays}d${token ? "" : ", no token to confirm freshness against Figma"} (max ${maxAgeDays}d) — re-run fetch-gold.`,
    );
  }
  return warnings;
}
