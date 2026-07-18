/**
 * Debug wrapper around capture() — not the package CLI (that is src/cli.ts).
 *
 *   pnpm capture -- <url> <outPath> <WxH> [selector]
 */
import { capture } from "../src/capture.ts";

const [url, outPath, vp, selector] = process.argv.slice(2);
if (!url || !outPath || !vp) {
  console.error("Usage: capture <url> <outPath> <WxH> [selector]");
  process.exit(2);
}
const [w, h] = vp.split("x").map(Number);
if (!w || !h) {
  console.error(`Invalid viewport ${vp}`);
  process.exit(2);
}

const result = await capture({
  url,
  outPath,
  viewportSize: { width: w, height: h },
  selector,
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
