/**
 * Thin CLI:
 *   figma-fidelity setup [--project] [--agents cursor,claude,codex,claude-desktop] [--dry-run]
 *   figma-fidelity mcp
 *   figma-fidelity run|compare|fetch-gold|done-gate … (debug; prefer MCP)
 *
 * Exit: 0 ok / pass, 1 fail, 2 usage/config.
 */
import * as path from "node:path";

import { compare } from "./compare/index.ts";
import { checkDoneGate } from "./done-gate.ts";
import { fetchGold } from "./fetch-gold.ts";
import { startMcpServer } from "./mcp.ts";
import { run } from "./run.ts";
import { ALL_AGENTS, detectClients, setupAgents, type AgentId, type LaunchMode } from "./setup.ts";
import type { ProfileName, RunType } from "./types.ts";

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function has(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function usage(): never {
  console.error(`Usage:
  figma-fidelity setup [--project] [--agents cursor,claude,codex,claude-desktop,vscode]
                       [--launch local|npx] [--force] [--dry-run]
    local = absolute package bin (default, cwd-safe); npx = npx -y figma-fidelity mcp
  figma-fidelity detect
  figma-fidelity mcp
  figma-fidelity fetch-gold --file-key <k> --node-id <id> --out <figma-gold.png> [--scale 1]
  figma-fidelity compare --gold <png> --actual <png> --out-dir <dir> [--profile component/strict]
  figma-fidelity run --url <url> --viewport <name> --viewport-size WxH --gold <png> --out-dir <dir>
                 (--node-id <id> | --selector <css>) [--profile …] [--page-reason …] [--run-type dev|final]
  figma-fidelity done-gate --node-id <id> --viewport <name> --out-dir <dir> [--viewport <name> --out-dir <dir>…]
`);
  process.exit(2);
}

async function cmdSetup(argv: string[]): Promise<void> {
  const agentsRaw = arg(argv, "--agents");
  let agents: AgentId[] | undefined;
  if (agentsRaw) {
    agents = agentsRaw.split(",").map((s) => s.trim()) as AgentId[];
    for (const a of agents) {
      if (!ALL_AGENTS.includes(a)) {
        console.error(`Unknown agent "${a}". Allowed: ${ALL_AGENTS.join(", ")}`);
        process.exit(2);
      }
    }
  }
  const launchRaw = arg(argv, "--launch") as LaunchMode | undefined;
  if (launchRaw && launchRaw !== "local" && launchRaw !== "npx") {
    console.error('--launch must be "local" or "npx"');
    process.exit(2);
  }
  const result = setupAgents({
    agents,
    project: has(argv, "--project"),
    dryRun: has(argv, "--dry-run"),
    force: has(argv, "--force"),
    launch: launchRaw,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdDetect(): Promise<void> {
  console.log(JSON.stringify({ clients: detectClients() }, null, 2));
}

async function cmdFetchGold(argv: string[]): Promise<void> {
  const fileKey = arg(argv, "--file-key");
  const nodeId = arg(argv, "--node-id");
  const outPath = arg(argv, "--out");
  if (!fileKey || !nodeId || !outPath) usage();
  const scaleRaw = arg(argv, "--scale");
  const result = await fetchGold({
    fileKey,
    nodeId,
    outPath,
    scale: scaleRaw ? Number(scaleRaw) : 1,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

async function cmdCompare(argv: string[]): Promise<void> {
  const gold = arg(argv, "--gold");
  const actual = arg(argv, "--actual");
  const outDir = arg(argv, "--out-dir") ?? (actual ? path.dirname(actual) : undefined);
  if (!gold || !actual || !outDir) usage();
  const profile = (arg(argv, "--profile") ?? "component/strict") as ProfileName;
  const result = compare(gold, actual, outDir, { profile });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

async function cmdRun(argv: string[]): Promise<void> {
  const url = arg(argv, "--url");
  const viewport = arg(argv, "--viewport");
  const vpSize = arg(argv, "--viewport-size");
  const goldPath = arg(argv, "--gold");
  const outDir = arg(argv, "--out-dir");
  const nodeId = arg(argv, "--node-id");
  const selector = arg(argv, "--selector");
  if (!url || !viewport || !vpSize || !goldPath || !outDir) usage();
  const [w, h] = vpSize.split("x").map(Number);
  if (!w || !h) {
    console.error(`Invalid --viewport-size ${vpSize}`);
    process.exit(2);
  }
  const result = await run({
    url,
    viewport,
    viewportSize: { width: w, height: h },
    goldPath,
    outDir,
    nodeId,
    selector,
    profile: arg(argv, "--profile") as ProfileName | undefined,
    pageReason: arg(argv, "--page-reason"),
    runType: (arg(argv, "--run-type") as RunType | undefined) ?? "dev",
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(2);
  process.exit(result.pass ? 0 : 1);
}

async function cmdDoneGate(argv: string[]): Promise<void> {
  const nodeId = arg(argv, "--node-id");
  if (!nodeId) usage();
  const viewports: { viewport: string; outDir: string }[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--viewport" && argv[i + 1]) {
      const viewport = argv[i + 1] as string;
      const outDirFlag = argv.indexOf("--out-dir", i + 1);
      const outDir = outDirFlag >= 0 ? argv[outDirFlag + 1] : undefined;
      if (!outDir) {
        console.error(`--viewport ${viewport} requires a following --out-dir`);
        process.exit(2);
      }
      viewports.push({ viewport, outDir });
    }
  }
  if (viewports.length === 0) usage();
  const verdict = checkDoneGate({ nodeId, viewports });
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.done ? 0 : 1);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();
  const rest = argv.slice(1);
  switch (cmd) {
    case "setup":
      await cmdSetup(rest);
      return;
    case "detect":
      await cmdDetect();
      return;
    case "mcp":
      await startMcpServer();
      return;
    case "fetch-gold":
      await cmdFetchGold(rest);
      return;
    case "compare":
      await cmdCompare(rest);
      return;
    case "run":
      await cmdRun(rest);
      return;
    case "done-gate":
      await cmdDoneGate(rest);
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
  }
}

const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("figma-fidelity.js"));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
