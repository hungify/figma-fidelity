/**
 * fetch-gold: Figma Images API → gold PNG on disk + figma-gold.meta.json sidecar.
 *
 * INDEPENDENT of fidelity_run — run() always compares against gold already on
 * disk, so no failure here may ever propagate into a fidelity verdict.
 *
 * Security: the token is read from env at call time, sent only as the
 * X-Figma-Token header, and never persisted, logged, or echoed in any message.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface FetchGoldOptions {
  fileKey: string;
  nodeId: string;
  /** Where the gold PNG is written (…/figma-gold.png). Sidecar goes next to it. */
  outPath: string;
  scale?: number;
  /**
   * Render at the node's absoluteBoundingBox (layout size) instead of render
   * bounds. Default true: DOM element screenshots use the border box and
   * exclude shadows, so gold must match layout size for area-gap/expect-size
   * to be meaningful (e.g. Frame 27 = 544x464, not 594x514 with shadow).
   */
  useAbsoluteBounds?: boolean;
  /** Overrides env lookup (FIGMA_ACCESS_TOKEN). */
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface ApiCallLogEntry {
  endpoint: string;
  timestamp: string;
  status: number;
}

export interface GoldMeta {
  nodeId: string;
  fileKey: string;
  lastModified: string | null;
  fetchedAt: string;
  apiCallCount: number;
  apiCallLog: ApiCallLogEntry[];
}

export type FetchGoldOutcome =
  | {
      ok: true;
      fetched: true;
      goldPath: string;
      metaPath: string;
      meta: GoldMeta;
      warnings: string[];
    }
  /** Retryable (network/5xx/429-after-retry): soft — old gold on disk stays usable. */
  | { ok: true; fetched: false; errorClass: "retryable"; message: string; warnings: string[] }
  /** Auth (401/403) or config (404 / unknown nodeId): hard fail of fetch-gold only. */
  | { ok: false; fetched: false; errorClass: "auth" | "config"; message: string };

export function resolveToken(explicit?: string): string | undefined {
  return explicit ?? process.env.FIGMA_ACCESS_TOKEN;
}

export async function fetchGold(options: FetchGoldOptions): Promise<FetchGoldOutcome> {
  const token = resolveToken(options.token);
  if (!token) {
    return {
      ok: false,
      fetched: false,
      errorClass: "config",
      message: "No Figma token found (set FIGMA_ACCESS_TOKEN).",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const apiCallLog: ApiCallLogEntry[] = [];
  const scale = options.scale ?? 1;

  const call = async (endpoint: string): Promise<Response> => {
    const doFetch = async () => {
      const res = await fetchImpl(`https://api.figma.com${endpoint}`, {
        headers: { "X-Figma-Token": token },
      });
      apiCallLog.push({
        endpoint: endpoint.split("?")[0] ?? endpoint,
        timestamp: new Date().toISOString(),
        status: res.status,
      });
      return res;
    };
    let res = await doFetch();
    if (res.status === 429) {
      // Exactly one retry honoring Retry-After — no silent retry loops.
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await sleep(Math.min(Math.max(retryAfter, 1), 60) * 1000);
      res = await doFetch();
    }
    return res;
  };

  const classify = (status: number, context: string): FetchGoldOutcome | null => {
    if (status === 401 || status === 403) {
      return {
        ok: false,
        fetched: false,
        errorClass: "auth",
        message: `Figma API rejected the token (${status}) during ${context}. Check FIGMA_ACCESS_TOKEN scopes.`,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        fetched: false,
        errorClass: "config",
        message: `nodeId not found in file (404) during ${context} — verify fileKey "${options.fileKey}" and nodeId "${options.nodeId}" (not an auth problem).`,
      };
    }
    if (status === 429 || status >= 500) {
      return {
        ok: true,
        fetched: false,
        errorClass: "retryable",
        message: `Figma API unavailable (${status}) during ${context}; existing gold on disk remains usable.`,
        warnings,
      };
    }
    return null;
  };

  try {
    // 1. Metadata (lastModified + node existence). Same call family spec-gate reuses.
    const metaRes = await call(
      `/v1/files/${options.fileKey}/nodes?ids=${encodeURIComponent(options.nodeId)}&depth=1`,
    );
    if (!metaRes.ok) {
      return (
        classify(metaRes.status, "metadata fetch") ?? {
          ok: true,
          fetched: false,
          errorClass: "retryable",
          message: `Unexpected Figma API status ${metaRes.status} during metadata fetch.`,
          warnings,
        }
      );
    }
    const metaJson = (await metaRes.json()) as {
      lastModified?: string;
      nodes?: Record<string, unknown>;
    };
    const nodeEntry = metaJson.nodes?.[options.nodeId];
    if (nodeEntry === null || nodeEntry === undefined) {
      return {
        ok: false,
        fetched: false,
        errorClass: "config",
        message: `nodeId not found in file — Figma returned no node for "${options.nodeId}" (not an auth problem).`,
      };
    }

    // 2. Images API render.
    const useAbsoluteBounds = options.useAbsoluteBounds ?? true;
    const imgRes = await call(
      `/v1/images/${options.fileKey}?ids=${encodeURIComponent(options.nodeId)}&format=png&scale=${scale}&use_absolute_bounds=${useAbsoluteBounds}`,
    );
    if (!imgRes.ok) {
      return (
        classify(imgRes.status, "image render") ?? {
          ok: true,
          fetched: false,
          errorClass: "retryable",
          message: `Unexpected Figma API status ${imgRes.status} during image render.`,
          warnings,
        }
      );
    }
    const imgJson = (await imgRes.json()) as {
      err?: string | null;
      images?: Record<string, string | null>;
    };
    const imageUrl = imgJson.images?.[options.nodeId];
    if (imgJson.err || !imageUrl) {
      return {
        ok: false,
        fetched: false,
        errorClass: "config",
        message: `Figma could not render nodeId "${options.nodeId}" (${imgJson.err ?? "no image URL returned"}).`,
      };
    }

    // 3. Download the rendered PNG (S3 URL — no token involved).
    const pngRes = await fetchImpl(imageUrl);
    apiCallLog.push({
      endpoint: "figma-image-cdn",
      timestamp: new Date().toISOString(),
      status: pngRes.status,
    });
    if (!pngRes.ok) {
      return {
        ok: true,
        fetched: false,
        errorClass: "retryable",
        message: `Image download failed (${pngRes.status}); existing gold on disk remains usable.`,
        warnings,
      };
    }
    const buf = Buffer.from(await pngRes.arrayBuffer());
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, buf);

    const meta: GoldMeta = {
      nodeId: options.nodeId,
      fileKey: options.fileKey,
      lastModified: metaJson.lastModified ?? null,
      fetchedAt: new Date().toISOString(),
      apiCallCount: apiCallLog.length,
      apiCallLog,
    };
    const metaPath = goldMetaPath(options.outPath);
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

    return { ok: true, fetched: true, goldPath: options.outPath, metaPath, meta, warnings };
  } catch (err) {
    return {
      ok: true,
      fetched: false,
      errorClass: "retryable",
      message: `Network error during fetch-gold (${sanitizeError(err)}); existing gold on disk remains usable.`,
      warnings,
    };
  }
}

export function goldMetaPath(goldPath: string): string {
  return path.join(path.dirname(goldPath), "figma-gold.meta.json");
}

export function readGoldMeta(goldPath: string): GoldMeta | null {
  const p = goldMetaPath(goldPath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GoldMeta;
  } catch {
    return null;
  }
}

/** Never echo request headers/URLs (token safety). */
function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replaceAll(/x-figma-token[^\s,;]*/gi, "[redacted]").slice(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
