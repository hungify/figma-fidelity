/**
 * Debug PNG crop helper (fixture prep).
 *
 *   pnpm crop -- <src> <out> <x> <y> <w> <h>
 */
import { PNG } from "pngjs";

import { readPng, writePng } from "../src/compare/png.ts";

const [src, out, xs, ys, ws, hs] = process.argv.slice(2);
if (!src || !out || !xs || !ys || !ws || !hs) {
  console.error("Usage: crop <src> <out> <x> <y> <w> <h>");
  process.exit(2);
}
const [x, y, w, h] = [Number(xs), Number(ys), Number(ws), Number(hs)];
const png = readPng(src);
const cropped = new PNG({ width: w, height: h });
PNG.bitblt(png, cropped, x, y, w, h, 0, 0);
writePng(out, cropped);
console.log(`wrote ${out} (${w}x${h} from ${x},${y})`);
