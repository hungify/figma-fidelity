import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkDoneGate, SCHEMA_VERSION } from "../src/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-donegate-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const FILE_KEY = "file-key";
const NODE = "153:5181";
const contract = {
  viewport: "desktop",
  outDir: "",
  fileKey: FILE_KEY,
  nodeId: NODE,
  profile: "component/strict" as const,
  selector: '[data-testid="auth.login"]',
  expectSize: { width: 544, height: 464 },
};

let n = 0;
function scoreDir(overrides: Record<string, unknown> = {}): string {
  const dir = path.join(tmp, `vp-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  const metaPath = path.join(dir, "figma-gold.meta.json");
  const goldPath = path.join(dir, "figma-gold.png");
  const fetchedAt = new Date().toISOString();
  for (const name of [
    "figma-gold.png",
    "actual.png",
    "diff.png",
    "run-meta.json",
    "punch-list.json",
  ]) {
    fs.writeFileSync(path.join(dir, name), "fixture");
  }
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ fileKey: FILE_KEY, nodeId: NODE, fetchedAt }),
  );
  const score = {
    schemaVersion: SCHEMA_VERSION,
    pass: true,
    runType: "final",
    capturedAt: new Date().toISOString(),
    fileKey: FILE_KEY,
    nodeId: NODE,
    viewport: "desktop",
    profile: "component/strict",
    selector: contract.selector,
    expectSize: contract.expectSize,
    stability: "stable",
    outDir: dir,
    gold: {
      path: goldPath,
      metaPath,
      fileKey: FILE_KEY,
      nodeId: NODE,
      fetchedAt,
    },
    evidenceHashes: {
      gold: fileHash(goldPath),
      goldMeta: fileHash(metaPath),
      actual: fileHash(path.join(dir, "actual.png")),
      diff: fileHash(path.join(dir, "diff.png")),
    },
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "visual-score.json"), JSON.stringify(score));
  return dir;
}

function fileHash(filePath: string): string {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function gate(outDir: string, overrides: Record<string, unknown> = {}) {
  return checkDoneGate({
    viewports: [{ ...contract, outDir, ...overrides }],
  });
}

describe("done gate schema v2", () => {
  it("accepts exact fresh contract with complete artifacts", () => {
    expect(gate(scoreDir()).done).toBe(true);
  });

  it("rejects missing viewport artifact", () => {
    const empty = path.join(tmp, `vp-${n++}`);
    fs.mkdirSync(empty, { recursive: true });
    const result = gate(empty);
    expect(result.done).toBe(false);
    expect(result.viewports[0]?.reasons[0]).toMatch(/missing visual-score/);
  });

  it("rejects non-v2, dev, failing, stale, future, and borderline scores", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    for (const overrides of [
      { schemaVersion: 1 },
      { runType: "dev" },
      { pass: false },
      { capturedAt: old },
      { capturedAt: future },
      { stability: "borderline" },
    ]) {
      expect(gate(scoreDir(overrides)).done).toBe(false);
    }
  });

  it("rejects profile, selector, size, node, and file mismatches", () => {
    expect(gate(scoreDir(), { profile: "component/dev" }).done).toBe(false);
    expect(gate(scoreDir(), { selector: "[data-testid=other]" }).done).toBe(false);
    expect(gate(scoreDir(), { expectSize: { width: 500, height: 400 } }).done).toBe(false);
    expect(gate(scoreDir(), { nodeId: "153:2364" }).done).toBe(false);
    expect(gate(scoreDir(), { fileKey: "other-file" }).done).toBe(false);
  });

  it("rejects copied score whose outDir or gold evidence differs", () => {
    expect(gate(scoreDir({ outDir: "/tmp/other" })).done).toBe(false);
    expect(gate(scoreDir({ gold: { fileKey: FILE_KEY, nodeId: "153:2364" } })).done).toBe(false);
  });

  it("rejects incomplete artifact set", () => {
    const dir = scoreDir();
    fs.unlinkSync(path.join(dir, "diff.png"));
    expect(gate(dir).done).toBe(false);
  });

  it("rejects artifact changed after score", () => {
    const dir = scoreDir();
    fs.writeFileSync(path.join(dir, "actual.png"), "tampered");
    expect(gate(dir).done).toBe(false);
  });

  it("rejects blocking residual cluster", () => {
    const result = gate(
      scoreDir({
        topIssues: [{ kind: "residual", severity: "medium", message: "cluster" }],
      }),
    );
    expect(result.done).toBe(false);
  });

  it("resolves relative outDir against cwd", () => {
    const dir = scoreDir();
    const relative = path.relative(tmp, dir);
    const result = checkDoneGate({
      cwd: tmp,
      viewports: [{ ...contract, outDir: relative }],
    });
    expect(result.done).toBe(true);
  });
});
