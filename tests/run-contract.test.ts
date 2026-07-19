import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { run } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-run-contract-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function base(outDir: string) {
  return {
    url: "http://localhost:3000/login",
    viewport: "desktop",
    viewportSize: { width: 1440, height: 1024 },
    goldPath: path.join(outDir, "figma-gold.png"),
    outDir,
    nodeId: "153:5181",
    selector: '[data-testid="auth.login"]',
    profile: "component/strict" as const,
    expectSize: { width: 544, height: 464 },
  };
}

describe("run schema-v2 contract guards", () => {
  it("invalidates old verdict before rejected run", async () => {
    const outDir = path.join(tmp, "stale");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "visual-score.json"), '{"pass":true}');
    const result = await run({ ...base(outDir), nodeId: undefined, selector: undefined });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(outDir, "visual-score.json"))).toBe(false);
  });

  it("requires gold metadata", async () => {
    const outDir = path.join(tmp, "no-meta");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "figma-gold.png"), "fixture");
    const result = await run(base(outDir));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("GOLD_META_REQUIRED");
  });

  it("rejects gold metadata for another node", async () => {
    const outDir = path.join(tmp, "wrong-node");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "figma-gold.png"), "fixture");
    fs.writeFileSync(
      path.join(outDir, "figma-gold.meta.json"),
      JSON.stringify({
        fileKey: "file-key",
        nodeId: "153:2364",
        fetchedAt: new Date().toISOString(),
      }),
    );
    const result = await run(base(outDir));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("GOLD_NODE_MISMATCH");
  });

  it("rejects malformed gold metadata", async () => {
    const outDir = path.join(tmp, "bad-meta");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "figma-gold.png"), "fixture");
    fs.writeFileSync(
      path.join(outDir, "figma-gold.meta.json"),
      JSON.stringify({ fileKey: "file-key", nodeId: "153:5181" }),
    );
    const result = await run(base(outDir));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("GOLD_META_INVALID");
  });

  it("requires conventional gold path inside contract directory", async () => {
    const outDir = path.join(tmp, "wrong-path");
    fs.mkdirSync(outDir, { recursive: true });
    const goldPath = path.join(tmp, "other-gold.png");
    fs.writeFileSync(goldPath, "fixture");
    const result = await run({ ...base(outDir), goldPath });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("GOLD_PATH_INVALID");
  });
});
