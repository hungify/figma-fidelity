/**
 * MCP server (stdio) — first-class agent API.
 * Tools wrap core; validation lives in scope.ts / capture.ts (not reimplemented here).
 *
 * CRITICAL: after connect, never write to stdout (stdio is the protocol).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { capture } from "./capture.ts";
import { compare } from "./compare/index.ts";
import { checkDoneGate } from "./done-gate.ts";
import { fetchGold } from "./fetch-gold.ts";
import { run } from "./run.ts";

const SERVER_NAME = "figma-fidelity";
const SERVER_VERSION = "0.1.0";

const profileSchema = z.enum(["page", "component/strict", "component/dev"]);
const runTypeSchema = z.enum(["dev", "final"]);
function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function jsonError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, message }, null, 2) }],
  };
}

export function createFidelityMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "fidelity_fetch_gold",
    {
      description:
        "Fetch Figma gold PNG via Images API + write figma-gold.meta.json. Independent of fidelity_run — failures never fail a run. Requires FIGMA_ACCESS_TOKEN in env.",
      inputSchema: {
        fileKey: z.string().min(1).describe("Figma file key"),
        nodeId: z.string().min(1).describe('Figma node id, e.g. "153:5181"'),
        outPath: z.string().min(1).describe("Output path for figma-gold.png"),
        scale: z.number().positive().optional().describe("Render scale (default 1)"),
      },
    },
    async (args) => {
      try {
        return jsonResult(await fetchGold(args));
      } catch (err) {
        return jsonError(err);
      }
    },
  );

  server.registerTool(
    "fidelity_capture",
    {
      description:
        "Hardened Playwright capture (DSF=1, no-animation, selector uniqueness guards). Prefer fidelity_run for a full verify loop.",
      inputSchema: {
        url: z.url().describe("Rendered app URL"),
        outPath: z.string().min(1).describe("Output actual.png path"),
        viewportWidth: z.number().int().positive(),
        viewportHeight: z.number().int().positive(),
        selector: z
          .string()
          .optional()
          .describe("CSS selector — must resolve to exactly 1 element"),
        samples: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        return jsonResult(
          await capture({
            url: args.url,
            outPath: args.outPath,
            viewportSize: { width: args.viewportWidth, height: args.viewportHeight },
            selector: args.selector,
            samples: args.samples,
          }),
        );
      } catch (err) {
        return jsonError(err);
      }
    },
  );

  server.registerTool(
    "fidelity_compare",
    {
      description:
        "Compare gold PNG vs actual PNG (area-gap → pixel → SSIM → ΔE). Does not capture. pass = per-signal thresholds only.",
      inputSchema: {
        goldPath: z.string().min(1),
        actualPath: z.string().min(1),
        outDir: z.string().min(1),
        profile: profileSchema.optional().describe("Default component/strict"),
        expectWidth: z.number().positive().optional(),
        expectHeight: z.number().positive().optional(),
      },
    },
    async (args) => {
      try {
        const expectSize =
          args.expectWidth != null && args.expectHeight != null
            ? { width: args.expectWidth, height: args.expectHeight }
            : undefined;
        return jsonResult(
          compare(args.goldPath, args.actualPath, args.outDir, {
            profile: args.profile ?? "component/strict",
            expectSize,
          }),
        );
      } catch (err) {
        return jsonError(err);
      }
    },
  );

  server.registerTool(
    "fidelity_run",
    {
      description:
        "Fresh guarded fidelity run: scope guards → capture → multi-signal compare → artifacts. REQUIRED: nodeId or selector, viewport. profile=page also requires pageReason. Gold must already exist on disk.",
      inputSchema: {
        url: z.url(),
        viewport: z.string().min(1).describe('"desktop" | "mobile" | custom label'),
        viewportWidth: z.number().int().positive(),
        viewportHeight: z.number().int().positive(),
        goldPath: z.string().min(1),
        outDir: z.string().min(1),
        nodeId: z.string().optional().describe("Figma node id (required unless selector)"),
        selector: z.string().optional().describe("Unique CSS selector (required unless nodeId)"),
        profile: profileSchema.optional(),
        pageReason: z
          .string()
          .optional()
          .describe("Required when profile=page — why full-viewport verify is intended"),
        runType: runTypeSchema.optional().describe('Use "final" before claiming done'),
        expectWidth: z.number().positive().optional(),
        expectHeight: z.number().positive().optional(),
        stabilitySamples: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        const expectSize =
          args.expectWidth != null && args.expectHeight != null
            ? { width: args.expectWidth, height: args.expectHeight }
            : undefined;
        return jsonResult(
          await run({
            url: args.url,
            viewport: args.viewport,
            viewportSize: { width: args.viewportWidth, height: args.viewportHeight },
            goldPath: args.goldPath,
            outDir: args.outDir,
            nodeId: args.nodeId,
            selector: args.selector,
            profile: args.profile,
            pageReason: args.pageReason,
            runType: args.runType,
            expectSize,
            stabilitySamples: args.stabilitySamples,
          }),
        );
      } catch (err) {
        return jsonError(err);
      }
    },
  );

  server.registerTool(
    "fidelity_done_gate",
    {
      description:
        'Artifact-gated "done" check per viewport. Requires pass:true + runType:final + fresh capturedAt + matching nodeId + stability:stable (or borderline + note after one manual re-run).',
      inputSchema: {
        nodeId: z.string().min(1),
        viewports: z
          .array(
            z.object({
              viewport: z.string().min(1),
              outDir: z.string().min(1),
              acceptBorderlineNote: z.string().optional(),
            }),
          )
          .min(1),
        maxScoreAgeMs: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      try {
        return jsonResult(checkDoneGate(args));
      } catch (err) {
        return jsonError(err);
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createFidelityMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("/mcp.ts") || process.argv[1].endsWith("/mcp.js"));

if (isMain) {
  startMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
