import * as fs from "node:fs";
import * as path from "node:path";

import { PNG } from "pngjs";

export function readPng(filePath: string): PNG {
  const buf = fs.readFileSync(filePath);
  return PNG.sync.read(buf);
}

export function writePng(filePath: string, png: PNG): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

/** Solid RGBA PNG (fixtures / synthetic mutations). */
export function makeSolidPng(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): PNG {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i << 2;
    png.data[o] = rgba[0];
    png.data[o + 1] = rgba[1];
    png.data[o + 2] = rgba[2];
    png.data[o + 3] = rgba[3];
  }
  return png;
}

/** Nearest-neighbor resize to target w×h. */
export function resizeNearest(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      const si = (src.width * sy + sx) << 2;
      const di = (width * y + x) << 2;
      out.data[di] = src.data[si] as number;
      out.data[di + 1] = src.data[si + 1] as number;
      out.data[di + 2] = src.data[si + 2] as number;
      out.data[di + 3] = src.data[si + 3] as number;
    }
  }
  return out;
}

/** Pad to a canvas of exactly w×h, anchored top-left, white fill. */
export function padTo(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src;
  const out = makeSolidPng(width, height, [255, 255, 255, 255]);
  const copyW = Math.min(src.width, width);
  const copyH = Math.min(src.height, height);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      const si = (src.width * y + x) << 2;
      const di = (width * y + x) << 2;
      out.data[di] = src.data[si] as number;
      out.data[di + 1] = src.data[si + 1] as number;
      out.data[di + 2] = src.data[si + 2] as number;
      out.data[di + 3] = src.data[si + 3] as number;
    }
  }
  return out;
}
