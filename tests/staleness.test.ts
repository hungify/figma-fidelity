import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkGoldStaleness } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-staleness-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function goldWithMeta(meta: Record<string, unknown>): string {
  const dir = path.join(tmp, `g-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const gold = path.join(dir, "figma-gold.png");
  fs.writeFileSync(gold, "png");
  fs.writeFileSync(path.join(dir, "figma-gold.meta.json"), JSON.stringify(meta));
  return gold;
}

const baseMeta = {
  nodeId: "153:5181",
  fileKey: "abc",
  lastModified: "2026-07-01T00:00:00Z",
  apiCallCount: 0,
  apiCallLog: [],
};

describe("gold staleness (warnings only, never hard-fail)", () => {
  it("no sidecar → warning", async () => {
    const dir = path.join(tmp, `g-${n++}`);
    fs.mkdirSync(dir, { recursive: true });
    const gold = path.join(dir, "figma-gold.png");
    fs.writeFileSync(gold, "png");
    const w = await checkGoldStaleness(gold, { token: "" });
    expect(w[0]).toMatch(/no figma-gold\.meta\.json/);
  });

  it("no token + fresh gold → no warnings", async () => {
    const gold = goldWithMeta({ ...baseMeta, fetchedAt: new Date().toISOString() });
    const w = await checkGoldStaleness(gold, { token: "" });
    expect(w).toHaveLength(0);
  });

  it("no token + old gold → time-based heuristic warning (does not detect real changes)", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const gold = goldWithMeta({ ...baseMeta, fetchedAt: old });
    const w = await checkGoldStaleness(gold, { token: "", maxAgeDays: 14 });
    expect(w[0]).toMatch(/not re-verified in \d+d, no token/);
  });

  function figmaMeta(lastModified: string): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({ lastModified, nodes: { [baseMeta.nodeId]: { document: {} } } }),
        { status: 200 },
      )) as typeof fetch;
  }

  it("token + changed lastModified → stale warning", async () => {
    const gold = goldWithMeta({ ...baseMeta, fetchedAt: new Date().toISOString() });
    const w = await checkGoldStaleness(gold, {
      token: "t",
      fetchImpl: figmaMeta("2026-07-18T09:00:00Z"),
    });
    expect(w[0]).toMatch(/gold may be stale/);
  });

  it("token + unchanged lastModified → clean", async () => {
    const gold = goldWithMeta({ ...baseMeta, fetchedAt: new Date().toISOString() });
    const w = await checkGoldStaleness(gold, {
      token: "t",
      fetchImpl: figmaMeta(baseMeta.lastModified),
    });
    expect(w).toHaveLength(0);
  });

  it("token + network failure → warning + time fallback, never a throw", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const gold = goldWithMeta({ ...baseMeta, fetchedAt: old });
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const w = await checkGoldStaleness(gold, { token: "t", fetchImpl });
    expect(w.some((x) => x.includes("re-check failed"))).toBe(true);
    expect(w.some((x) => x.includes("not re-verified"))).toBe(true);
  });
});
