import type { PNG } from "pngjs";
import { ssim } from "ssim.js";

/** Mean SSIM between two same-size images (0..1, higher = more similar). */
export function ssimCompare(gold: PNG, actual: PNG): number {
  const a = toImageData(gold);
  const b = toImageData(actual);
  const { mssim } = ssim(a, b);
  return mssim;
}

function toImageData(png: PNG): { data: Uint8ClampedArray; width: number; height: number } {
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  };
}
