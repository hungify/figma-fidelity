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

/** Count real (red) diff pixels — excludes AA yellow. */
export function countRealDiffPixels(diff: PNG): number {
  const { width, height, data } = diff;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (isRealDiffPixel(data, i)) n += 1;
    }
  }
  return n;
}

export interface DiffCluster {
  pixels: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Largest 4-connected red region. Separates broken controls from dispersed text rasterization. */
export function largestRealDiffCluster(diff: PNG): DiffCluster | null {
  const { width, height, data } = diff;
  const seen = new Uint8Array(width * height);
  let largest: DiffCluster | null = null;

  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isRealDiffPixel(data, start << 2)) continue;
    const stack = [start];
    seen[start] = 1;
    let pixels = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    while (stack.length > 0) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      pixels += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || seen[next] || !isRealDiffPixel(data, next << 2)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (!largest || pixels > largest.pixels) {
      largest = { pixels, bbox: { x0, y0, x1, y1 } };
    }
  }
  return largest;
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
