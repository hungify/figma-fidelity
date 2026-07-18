import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/** Playwright-style per-pixel YIQ threshold. */
export const PIXEL_THRESHOLD = 0.2;
const CLUSTER_GRID = 4;
/** Fail page-level pass when one grid cell is this far below minMatch. */
const CLUSTER_SLACK = 0.02;

export interface PixelResult {
  matchRatio: number;
  diffPixels: number;
  totalPixels: number;
  diff: PNG;
  worstCellMatchRatio: number;
}

export function pixelCompare(gold: PNG, actual: PNG, threshold = PIXEL_THRESHOLD): PixelResult {
  const { width, height } = gold;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(gold.data, actual.data, diff.data, width, height, {
    threshold,
    includeAA: true,
  });
  const totalPixels = width * height;
  const matchRatio = totalPixels === 0 ? 0 : 1 - diffPixels / totalPixels;
  return {
    matchRatio,
    diffPixels,
    totalPixels,
    diff,
    worstCellMatchRatio: worstGridMatchRatio(diff),
  };
}

/** True red diff pixel (excludes pixelmatch's AA yellow). */
function isRealDiffPixel(data: Buffer | Uint8Array, i: number): boolean {
  return (
    (data[i] as number) > 200 &&
    (data[i + 1] as number) < 80 &&
    (data[i + 2] as number) < 80 &&
    (data[i + 3] as number) > 128
  );
}

/**
 * Real (red) diffs per grid cell → worst cell match ratio.
 * Catches chrome-ok / card-wrong on full-page compares.
 */
export function worstGridMatchRatio(diff: PNG, grid = CLUSTER_GRID): number {
  const { width, height, data } = diff;
  const cellW = Math.ceil(width / grid);
  const cellH = Math.ceil(height / grid);
  let worst = 1;

  for (let cy = 0; cy < grid; cy++) {
    for (let cx = 0; cx < grid; cx++) {
      const x0 = cx * cellW;
      const y0 = cy * cellH;
      const x1 = Math.min(width, x0 + cellW);
      const y1 = Math.min(height, y0 + cellH);
      let cellDiff = 0;
      let cellTotal = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          cellTotal += 1;
          const i = (width * y + x) << 2;
          if (isRealDiffPixel(data, i)) cellDiff += 1;
        }
      }
      if (cellTotal === 0) continue;
      const cellMatch = 1 - cellDiff / cellTotal;
      if (cellMatch < worst) worst = cellMatch;
    }
  }

  return worst;
}

export function clusterFails(
  matchRatio: number,
  worstCellMatchRatio: number,
  minMatch: number,
): boolean {
  return matchRatio >= minMatch && worstCellMatchRatio < minMatch - CLUSTER_SLACK;
}

/** Bounding box of real (red) diff pixels; null when no real diffs. */
export function diffBoundingBox(
  diff: PNG,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const { width, height, data } = diff;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (isRealDiffPixel(data, i)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}
