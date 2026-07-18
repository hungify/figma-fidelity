import * as fs from "node:fs";
import * as path from "node:path";

import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";

import type { RejectResult } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

const NETWORK_IDLE_BUFFER_MS = 300;
/** Dev servers (HMR websocket, devtools polling) may never go fully idle. */
const NETWORK_IDLE_BEST_EFFORT_MS = 5_000;
const SELECTOR_TIMEOUT_MS = 15_000;

const NO_ANIMATION_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

export interface CaptureOptions {
  url: string;
  /** First capture is written here (actual.png). */
  outPath: string;
  viewportSize: { width: number; height: number };
  /** Must resolve to exactly 1 element; omit only for page-profile runs. */
  selector?: string;
  fullPage?: boolean;
  /** Extra captures for the stability check; written next to outPath as stability-N.png. */
  samples?: number;
  timeoutMs?: number;
}

export interface CaptureSuccess {
  ok: true;
  /** actual.png followed by stability sample paths. */
  capturePaths: string[];
  capturedAt: string;
  /** Border-box size of the selector element (DPR=1) — spec-gate input. */
  elementRect: { width: number; height: number } | null;
  warnings: string[];
}

export type CaptureOutcome = CaptureSuccess | RejectResult;

/**
 * Hardened capture:
 * - force-device-scale-factor=1 + disable-gpu (deterministic rasterization)
 * - no-animation CSS injection
 * - networkidle + buffer
 * - server-freshness: full reload after initial load — Vite dev transforms
 *   on demand from disk, so a fresh reload serves the current source (no HMR
 *   race). Reload failure degrades to a warning, never a hard fail.
 * - selector guard (checks 3–4): 0 matches → SELECTOR_NOT_FOUND,
 *   >1 matches → SELECTOR_AMBIGUOUS. Runs before any screenshot.
 */
export async function capture(options: CaptureOptions): Promise<CaptureOutcome> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const warnings: string[] = [];

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      args: ["--force-device-scale-factor=1", "--disable-gpu"],
    });
    const page = await browser.newPage({
      viewport: options.viewportSize,
      deviceScaleFactor: 1,
    });

    await page.goto(options.url, { waitUntil: "load", timeout: timeoutMs });

    // Server-freshness: reload so the dev server serves the latest module graph.
    try {
      await page.reload({ waitUntil: "load", timeout: timeoutMs });
    } catch {
      warnings.push(
        "server-freshness: could not confirm server rebuild completed (reload failed); capture may be stale.",
      );
    }
    await settle(page, warnings);

    // Selector guard — checks 3–4, before any screenshot.
    if (options.selector) {
      const reject = await resolveSelector(page, options.selector);
      if (reject) return reject;
    }

    const capturedAt = new Date().toISOString();
    const capturePaths: string[] = [];
    const samples = Math.max(1, options.samples ?? 1);
    let elementRect: { width: number; height: number } | null = null;

    for (let i = 0; i < samples; i++) {
      const outPath =
        i === 0
          ? options.outPath
          : path.join(
              path.dirname(options.outPath),
              `stability-${i + 1}${path.extname(options.outPath) || ".png"}`,
            );

      if (i > 0) {
        // Re-render from scratch so the sample measures real capture variance.
        try {
          await page.reload({ waitUntil: "load", timeout: timeoutMs });
        } catch {
          warnings.push(`stability sample ${i + 1}: reload failed; sampled without reload.`);
        }
        await settle(page, warnings);
      }

      if (options.selector) {
        const loc = page.locator(options.selector);
        await loc.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
        if (i === 0) {
          const box = await loc.boundingBox();
          if (box) elementRect = { width: box.width, height: box.height };
        }
        await loc.screenshot({ path: outPath, animations: "disabled" });
      } else {
        await page.screenshot({
          path: outPath,
          fullPage: options.fullPage ?? false,
          animations: "disabled",
        });
      }
      capturePaths.push(outPath);
    }

    return { ok: true, capturePaths, capturedAt, elementRect, warnings };
  } finally {
    await browser?.close();
  }
}

/** Checks 3–4. Pure DOM query — exactly 1 element or reject. */
async function resolveSelector(page: Page, selector: string): Promise<RejectResult | null> {
  const matchCount = await page.locator(selector).count();
  if (matchCount === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SELECTOR_NOT_FOUND",
      message: "Selector matched 0 elements in the rendered page.",
    };
  }
  if (matchCount > 1) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SELECTOR_AMBIGUOUS",
      message: `Selector matched ${matchCount} elements; provide a unique selector or nth-match index.`,
      matchCount,
    };
  }
  return null;
}

async function settle(page: Page, warnings: string[]): Promise<void> {
  // Best-effort network idle: HMR websockets / devtools polling can keep a dev
  // server from ever going idle — freshness is guaranteed by the reload, so a
  // timeout here is not a staleness signal.
  await page
    .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_BEST_EFFORT_MS })
    .catch(() => {});
  try {
    await page.addStyleTag({ content: NO_ANIMATION_CSS });
  } catch {
    warnings.push("could not inject no-animation CSS.");
  }
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    }
  });
  await hideDevtoolsChrome(page);
  await page.waitForTimeout(NETWORK_IDLE_BUFFER_MS);
}

/** Product UI only — hide the floating TanStack Devtools trigger. */
async function hideDevtoolsChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const hide: HTMLElement[] = [];
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement;
      const text = (el.textContent ?? "").trim();
      if (text.startsWith("TANSTACK")) {
        hide.push(el);
      }
    }
    for (const el of hide) {
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.position === "fixed" || style.position === "sticky") {
          node.style.setProperty("display", "none", "important");
          break;
        }
        node = node.parentElement;
      }
    }
  });
}
