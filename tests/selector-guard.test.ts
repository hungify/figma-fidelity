import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { capture } from "../src/index.ts";

const stubDir = path.join(import.meta.dirname, "fixtures", "dom-stubs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-selector-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function stubUrl(name: string): string {
  return pathToFileURL(path.join(stubDir, name)).href;
}

describe("selector guard (checks 3–4, DOM stub — no PNG fixtures needed)", () => {
  it("SELECTOR_NOT_FOUND on 0 matches", async () => {
    const r = await capture({
      url: stubUrl("selector-not-found.stub.html"),
      outPath: path.join(tmp, "nf", "actual.png"),
      viewportSize: { width: 640, height: 480 },
      selector: "[data-testid=target]",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("SELECTOR_NOT_FOUND");
    }
    // Guard fires before any screenshot.
    expect(fs.existsSync(path.join(tmp, "nf", "actual.png"))).toBe(false);
  });

  it("SELECTOR_AMBIGUOUS with matchCount on >1 matches", async () => {
    const r = await capture({
      url: stubUrl("selector-ambiguous.stub.html"),
      outPath: path.join(tmp, "amb", "actual.png"),
      viewportSize: { width: 640, height: 480 },
      selector: "[data-testid=target]",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("SELECTOR_AMBIGUOUS");
      expect(r.matchCount).toBe(3);
    }
    expect(fs.existsSync(path.join(tmp, "amb", "actual.png"))).toBe(false);
  });

  it("unique selector captures exactly the element", async () => {
    const out = path.join(tmp, "ok", "actual.png");
    const r = await capture({
      url: stubUrl("selector-unique.stub.html"),
      outPath: out,
      viewportSize: { width: 640, height: 480 },
      selector: "[data-testid=target]",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.capturePaths).toEqual([out]);
      expect(r.capturedAt).toBeTruthy();
    }
    expect(fs.existsSync(out)).toBe(true);
  });
});
