/**
 * Debug wrapper around fetchGold() — not the package CLI (that is src/cli.ts).
 *
 *   pnpm fetch-gold -- <fileKey> <nodeId> <outPath> [scale]
 *
 * Token from FIGMA_ACCESS_TOKEN. Never printed.
 */
import { fetchGold } from "../src/fetch-gold.ts";

const [fileKey, nodeId, outPath, scaleRaw] = process.argv.slice(2);
if (!fileKey || !nodeId || !outPath) {
  console.error("Usage: fetch-gold <fileKey> <nodeId> <outPath> [scale]");
  process.exit(2);
}

const result = await fetchGold({
  fileKey,
  nodeId,
  outPath,
  scale: scaleRaw ? Number(scaleRaw) : 1,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
if (!result.fetched) process.exit(0); // retryable: soft, old gold stays usable
