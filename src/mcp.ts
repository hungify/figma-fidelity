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
import { loadNearestEnv } from "./load-env.ts";
import { resolveArtifactPath } from "./paths.ts";
import { run } from "./run.ts";

// MCP stdio often starts without the user's shell — pull FIGMA_ACCESS_TOKEN from .env.
loadNearestEnv();

const SERVER_NAME = "figma-fidelity";
const SERVER_VERSION = "0.2.0";
const DEBUG_TOOLS_ENV = "FIGMA_FIDELITY_DEBUG_TOOLS";

export interface FidelityMcpServerOptions {
  includeDebugTools?: boolean;
}

const profileSchema = z.enum(["page", "component/strict", "component/dev"]);
const runTypeSchema = z.enum(["dev", "final"]);
const expectSizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

/** Optional cwd override for relative path resolution (MCP often not in repo root). */
const cwdSchema = z
  .string()
  .optional()
  .describe(
    "Resolve relative artifact paths against this directory. Prefer absolute paths; default process.cwd() of the MCP server (often NOT the app repo).",
  );

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

function resolvePaths(
  paths: Record<string, string | undefined>,
  cwd?: string,
): Record<string, string | undefined> {
  const base = cwd ?? process.cwd();
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(paths)) {
    out[k] = v != null ? resolveArtifactPath(v, base) : undefined;
  }
  return out;
}

function debugToolsEnabled(): boolean {
  return process.env[DEBUG_TOOLS_ENV] === "1";
}

export function createFidelityMcpServer(options: FidelityMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const includeDebugTools = options.includeDebugTools ?? debugToolsEnabled();

  server.registerTool(
    "fidelity_fetch_gold",
    {
      description:
        "Fetch Figma gold PNG via Images API + write figma-gold.meta.json. Independent of fidelity_run — failures never fail a run. Requires FIGMA_ACCESS_TOKEN in env. Prefer absolute outPath.",
      inputSchema: {
        fileKey: z.string().min(1).describe("Figma file key"),
        nodeId: z.string().min(1).describe('Figma node id, e.g. "153:5181"'),
        outPath: z.string().min(1).describe("Output path for figma-gold.png (absolute preferred)"),
        scale: z.number().positive().optional().describe("Render scale (default 1)"),
        canvasFill: z
          .string()
          .optional()
          .describe(
            "Solid hex (#fff/#ffffff). Alpha-composites gold onto this fill before write — use when Figma PNG has transparency/soft shadows vs opaque app capture.",
          ),
        cwd: cwdSchema,
      },
    },
    async (args) => {
      try {
        const { outPath } = resolvePaths({ outPath: args.outPath }, args.cwd);
        return jsonResult(
          await fetchGold({
            fileKey: args.fileKey,
            nodeId: args.nodeId,
            outPath: outPath!,
            scale: args.scale,
            canvasFill: args.canvasFill,
          }),
        );
      } catch (err) {
        return jsonError(err);
      }
    },
  );

  if (includeDebugTools) {
    server.registerTool(
      "fidelity_capture",
      {
        description:
          "Debug-only hardened Playwright capture (DSF=1, no-animation, selector uniqueness guards). Prefer fidelity_run for verification.",
        inputSchema: {
          url: z.url().describe("Rendered app URL"),
          outPath: z.string().min(1).describe("Output actual.png path (absolute preferred)"),
          viewportWidth: z.number().int().positive(),
          viewportHeight: z.number().int().positive(),
          selector: z
            .string()
            .optional()
            .describe("CSS selector — must resolve to exactly 1 element"),
          samples: z.number().int().positive().optional(),
          cwd: cwdSchema,
        },
      },
      async (args) => {
        try {
          const { outPath } = resolvePaths({ outPath: args.outPath }, args.cwd);
          return jsonResult(
            await capture({
              url: args.url,
              outPath: outPath!,
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
          "Debug-only compare of existing gold and actual PNGs. Does not capture. Inspect diff.png even when pass=true.",
        inputSchema: {
          goldPath: z.string().min(1).describe("Absolute preferred"),
          actualPath: z.string().min(1).describe("Absolute preferred"),
          outDir: z.string().min(1).describe("Artifact dir (absolute preferred)"),
          profile: profileSchema.optional().describe("Default component/strict"),
          expectSize: expectSizeSchema.optional(),
          cwd: cwdSchema,
        },
      },
      async (args) => {
        try {
          const resolved = resolvePaths(
            {
              goldPath: args.goldPath,
              actualPath: args.actualPath,
              outDir: args.outDir,
            },
            args.cwd,
          );
          return jsonResult(
            compare(resolved.goldPath!, resolved.actualPath!, resolved.outDir!, {
              profile: args.profile ?? "component/strict",
              expectSize: args.expectSize,
            }),
          );
        } catch (err) {
          return jsonError(err);
        }
      },
    );
  }

  server.registerTool(
    "fidelity_run",
    {
      description:
        "Fresh fidelity contract. Component profiles require nodeId + unique selector; component/strict also requires expectSize. Page requires nodeId + valid pageReason and forbids selector/expectSize. Gold must be <outDir>/figma-gold.png with matching meta. Failed runs invalidate old score artifacts.",
      inputSchema: {
        url: z.url(),
        viewport: z.string().min(1).describe('"desktop" | "mobile" | custom label'),
        viewportWidth: z.number().int().positive(),
        viewportHeight: z.number().int().positive(),
        goldPath: z.string().min(1).describe("Absolute preferred"),
        outDir: z.string().min(1).describe("Absolute preferred"),
        nodeId: z.string().min(1).describe("Figma node id bound to gold metadata"),
        selector: z
          .string()
          .optional()
          .describe("Required for component profiles; forbidden for page"),
        profile: profileSchema
          .optional()
          .describe("Default component/strict when scoped. page requires pageReason."),
        pageReason: z
          .string()
          .optional()
          .describe(
            "Required when profile=page — why full-viewport verify is intended. Do not cite alpha/shadow/bleed as reasons to skip content crop.",
          ),
        runType: runTypeSchema.optional().describe('Use "final" before claiming done'),
        expectSize: expectSizeSchema
          .optional()
          .describe("Required for component/strict; forbidden for page"),
        stabilitySamples: z.number().int().positive().optional(),
        cwd: cwdSchema,
      },
    },
    async (args) => {
      try {
        const resolved = resolvePaths({ goldPath: args.goldPath, outDir: args.outDir }, args.cwd);
        return jsonResult(
          await run({
            url: args.url,
            viewport: args.viewport,
            viewportSize: { width: args.viewportWidth, height: args.viewportHeight },
            goldPath: resolved.goldPath!,
            outDir: resolved.outDir!,
            nodeId: args.nodeId,
            selector: args.selector,
            profile: args.profile,
            pageReason: args.pageReason,
            runType: args.runType,
            expectSize: args.expectSize,
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
        "Artifact completion gate. Every viewport declares exact fileKey/nodeId/profile/selector/expectSize contract. Requires final stable PASS, fresh score, matching gold metadata, and complete artifacts.",
      inputSchema: {
        viewports: z
          .array(
            z.object({
              viewport: z.string().min(1),
              outDir: z.string().min(1).describe("Absolute preferred"),
              fileKey: z.string().min(1),
              nodeId: z.string().min(1),
              profile: profileSchema,
              selector: z.string().min(1).optional(),
              expectSize: expectSizeSchema.optional(),
            }),
          )
          .min(1),
        cwd: cwdSchema,
      },
    },
    async (args) => {
      try {
        return jsonResult(
          checkDoneGate({
            viewports: args.viewports,
            cwd: args.cwd,
          }),
        );
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
