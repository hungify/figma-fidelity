/**
 * One-command MCP wiring — aligned with open-source patterns:
 * - Playwright / Chrome DevTools: stdio entry via `npx` (portable), standard JSON snippet
 * - github/github-mcp-server: per-client paths, never commit secrets
 * - universal-mcp-installer: detect clients, backup before write, Windows npx wrap,
 *   VS Code uses `servers` (not `mcpServers`)
 *
 * Never persists FIGMA_ACCESS_TOKEN values into config files.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentId = "cursor" | "claude" | "claude-desktop" | "codex" | "vscode";

export const ALL_AGENTS: AgentId[] = ["cursor", "claude", "claude-desktop", "codex", "vscode"];

export type LaunchMode = "local" | "npx";

export interface SetupOptions {
  /** Agents to wire. Default: all *detected* agents. */
  agents?: AgentId[];
  /** Also write project-scoped configs in cwd. */
  project?: boolean;
  projectRoot?: string;
  packageRoot?: string;
  homeDir?: string;
  dryRun?: boolean;
  /**
   * local (default): absolute path to package `bin/figma-fidelity.js mcp`
   *   — cwd-independent (Cursor/Codex often spawn MCP outside the project root).
   * npx: `npx -y figma-fidelity mcp` — after the package is published to npm.
   */
  launch?: LaunchMode;
  /** Write even if client install is not detected. */
  force?: boolean;
}

export interface SetupTargetResult {
  agent: AgentId | "cursor-project" | "claude-project" | "vscode-project" | "codex-project";
  path: string;
  action: "created" | "updated" | "skipped" | "would-write";
  detail?: string;
}

export interface SetupResult {
  ok: true;
  serverEntry: StdioServerEntry;
  detected: AgentId[];
  targets: SetupTargetResult[];
  standardConfig: { mcpServers: Record<string, StdioServerEntry> };
  nextSteps: string[];
}

export interface StdioServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const SERVER_KEY = "figma-fidelity";
const PACKAGE_NAME = "figma-fidelity";

export function resolvePackageRoot(override?: string): string {
  if (override) return path.resolve(override);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Prefer host `node_modules/figma-fidelity/bin/…` (stable symlink) over the
 * pnpm virtual-store realpath (ugly `…/.pnpm/figma-fidelity@https+++…` path).
 */
export function resolveMcpBin(packageRoot: string, projectRoot?: string): string {
  const candidates = [
    projectRoot
      ? path.join(projectRoot, "node_modules", PACKAGE_NAME, "bin", "figma-fidelity.js")
      : null,
    path.join(packageRoot, "bin", "figma-fidelity.js"),
  ].filter((p): p is string => Boolean(p));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return path.resolve(packageRoot, "bin", "figma-fidelity.js");
}

/**
 * Stdio launch entry written into agent MCP configs.
 *
 * Default (`local`) = absolute package bin, cwd-independent. Do NOT use
 * `pnpm exec` — Cursor/Codex often spawn MCP outside the project root.
 */
export function buildServerEntry(
  packageRoot: string,
  launch: LaunchMode = "local",
  projectRoot?: string,
): StdioServerEntry {
  if (launch === "npx") {
    return wrapNpx(["-y", PACKAGE_NAME, "mcp"]);
  }
  const binJs = resolveMcpBin(packageRoot, projectRoot);
  // Windows: shebang on .js is unreliable — invoke via the current Node binary.
  if (process.platform === "win32") {
    return { command: process.execPath, args: [binJs, "mcp"] };
  }
  return { command: binJs, args: ["mcp"] };
}

/** Windows agents often need `cmd /c npx …` (universal-mcp-installer pattern). */
export function wrapNpx(npxArgs: string[]): StdioServerEntry {
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "npx", ...npxArgs] };
  }
  return { command: "npx", args: npxArgs };
}

export interface DetectedClient {
  id: AgentId;
  path: string;
  present: boolean;
  reason?: string;
}

/** Detect which agent configs/apps exist on this machine. */
export function detectClients(
  homeDir = os.homedir(),
  projectRoot = process.cwd(),
): DetectedClient[] {
  const desktopPath = claudeDesktopPath(homeDir);
  return [
    {
      id: "cursor",
      path: path.join(homeDir, ".cursor", "mcp.json"),
      present:
        fs.existsSync(path.join(homeDir, ".cursor")) ||
        fs.existsSync(path.join(homeDir, ".cursor", "mcp.json")),
      reason: "Cursor config dir",
    },
    {
      id: "claude",
      path: path.join(homeDir, ".claude.json"),
      present: fs.existsSync(path.join(homeDir, ".claude.json")) || commandExists("claude"),
      reason: "Claude Code CLI / ~/.claude.json",
    },
    {
      id: "claude-desktop",
      path: desktopPath,
      present: fs.existsSync(path.dirname(desktopPath)) || fs.existsSync(desktopPath),
      reason: "Claude Desktop app dir",
    },
    {
      id: "codex",
      path: path.join(homeDir, ".codex", "config.toml"),
      present:
        fs.existsSync(path.join(homeDir, ".codex")) ||
        fs.existsSync(path.join(homeDir, ".codex", "config.toml")) ||
        commandExists("codex"),
      reason: "Codex home / CLI",
    },
    {
      id: "vscode",
      // VS Code is workspace-scoped — "present" if code CLI or .vscode exists in project
      path: path.join(projectRoot, ".vscode", "mcp.json"),
      present: commandExists("code") || fs.existsSync(path.join(projectRoot, ".vscode")),
      reason: "VS Code CLI / .vscode",
    },
  ];
}

export function setupAgents(options: SetupOptions = {}): SetupResult {
  const home = options.homeDir ?? os.homedir();
  const packageRoot = resolvePackageRoot(options.packageRoot);
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const launch = options.launch ?? "local";
  const entry = buildServerEntry(packageRoot, launch, projectRoot);
  const detectedList = detectClients(home, projectRoot);
  const detected = detectedList.filter((d) => d.present).map((d) => d.id);

  // Explicit --agents → honor list. Default → only detected clients (vscode needs --project).
  const effective: AgentId[] = options.agents?.length
    ? options.agents
    : ALL_AGENTS.filter(
        (a) => detected.includes(a) || (a === "vscode" && Boolean(options.project)),
      );

  const targets: SetupTargetResult[] = [];
  const writeJson = (
    filePath: string,
    agent: SetupTargetResult["agent"],
    mutate: (doc: Record<string, unknown>) => void,
  ) => {
    const existed = fs.existsSync(filePath);
    let doc: Record<string, unknown> = {};
    if (existed) {
      try {
        doc = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
      } catch {
        targets.push({
          agent,
          path: filePath,
          action: "skipped",
          detail: "unreadable JSON — fix manually then re-run setup",
        });
        return;
      }
    }
    mutate(doc);
    if (options.dryRun) {
      targets.push({ agent, path: filePath, action: "would-write" });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (existed) backupFile(filePath);
    atomicWriteJson(filePath, doc);
    targets.push({ agent, path: filePath, action: existed ? "updated" : "created" });
  };

  const mergeMcpServers = (doc: Record<string, unknown>) => {
    const servers =
      doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers)
        ? { ...(doc.mcpServers as Record<string, unknown>) }
        : {};
    servers[SERVER_KEY] = entry;
    doc.mcpServers = servers;
  };

  /** VS Code Copilot uses `.vscode/mcp.json` → `servers` (not `mcpServers`). */
  const mergeVsCodeServers = (doc: Record<string, unknown>) => {
    const servers =
      doc.servers && typeof doc.servers === "object" && !Array.isArray(doc.servers)
        ? { ...(doc.servers as Record<string, unknown>) }
        : {};
    servers[SERVER_KEY] = { type: "stdio", ...entry };
    doc.servers = servers;
  };

  for (const id of effective) {
    if (id === "cursor") {
      writeJson(path.join(home, ".cursor", "mcp.json"), "cursor", mergeMcpServers);
    } else if (id === "claude") {
      writeJson(path.join(home, ".claude.json"), "claude", mergeMcpServers);
    } else if (id === "claude-desktop") {
      const desktopPath = claudeDesktopPath(home);
      if (fs.existsSync(path.dirname(desktopPath)) || fs.existsSync(desktopPath) || options.force) {
        writeJson(desktopPath, "claude-desktop", mergeMcpServers);
      } else {
        targets.push({
          agent: "claude-desktop",
          path: desktopPath,
          action: "skipped",
          detail: "Claude Desktop config dir not found (use --force to write anyway)",
        });
      }
    } else if (id === "codex") {
      targets.push(
        ...setupCodexToml(path.join(home, ".codex", "config.toml"), entry, options.dryRun ?? false),
      );
    } else if (id === "vscode" && !options.project) {
      // Global VS Code MCP is uncommon; prefer --project. Hint only unless forced.
      if (options.force) {
        writeJson(path.join(projectRoot, ".vscode", "mcp.json"), "vscode", mergeVsCodeServers);
      } else {
        targets.push({
          agent: "vscode",
          path: path.join(projectRoot, ".vscode", "mcp.json"),
          action: "skipped",
          detail: "VS Code MCP is workspace-scoped — re-run with --project",
        });
      }
    }
  }

  if (options.project) {
    if (effective.includes("cursor") || options.agents == null) {
      writeJson(path.join(projectRoot, ".cursor", "mcp.json"), "cursor-project", mergeMcpServers);
    }
    if (effective.includes("claude") || options.agents == null) {
      writeJson(path.join(projectRoot, ".mcp.json"), "claude-project", mergeMcpServers);
    }
    if (
      effective.includes("vscode") ||
      options.agents == null ||
      options.agents?.includes("vscode")
    ) {
      writeJson(
        path.join(projectRoot, ".vscode", "mcp.json"),
        "vscode-project",
        mergeVsCodeServers,
      );
    }
    if (effective.includes("codex") || options.agents == null) {
      const projectCodex = setupCodexToml(
        path.join(projectRoot, ".codex", "config.toml"),
        entry,
        options.dryRun ?? false,
      ).map((t) => ({ ...t, agent: "codex-project" as const }));
      targets.push(...projectCodex);
    }
  }

  const nextSteps = [
    "Ensure FIGMA_ACCESS_TOKEN is set in your shell / project .env (never committed).",
    "Restart agent sessions (or reload MCP) so they pick up the new server.",
    "Smoke: ask the agent to call fidelity_fetch_gold or fidelity_run.",
    "Or paste the standardConfig JSON into any MCP client manually (Playwright-style).",
  ];

  return {
    ok: true,
    serverEntry: entry,
    detected,
    targets,
    standardConfig: { mcpServers: { [SERVER_KEY]: entry } },
    nextSteps,
  };
}

export function setupCodexToml(
  codexPath: string,
  entry: StdioServerEntry,
  dryRun: boolean,
): SetupTargetResult[] {
  const sectionHeader = `[mcp_servers.${SERVER_KEY}]`;
  const block = [
    sectionHeader,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    "",
  ].join("\n");

  if (!fs.existsSync(codexPath)) {
    if (dryRun) {
      return [{ agent: "codex", path: codexPath, action: "would-write", detail: "file missing" }];
    }
    fs.mkdirSync(path.dirname(codexPath), { recursive: true });
    fs.writeFileSync(codexPath, `${block}\n`);
    return [{ agent: "codex", path: codexPath, action: "created" }];
  }

  const original = fs.readFileSync(codexPath, "utf8");
  const next = upsertTomlSection(original, sectionHeader, block);
  if (next === original) {
    return [{ agent: "codex", path: codexPath, action: "updated", detail: "already current" }];
  }
  if (dryRun) {
    return [{ agent: "codex", path: codexPath, action: "would-write" }];
  }
  backupFile(codexPath);
  fs.writeFileSync(codexPath, next);
  return [{ agent: "codex", path: codexPath, action: "updated" }];
}

export function upsertTomlSection(source: string, sectionHeader: string, block: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === sectionHeader);
  if (start === -1) {
    const trimmed = source.replace(/\s*$/, "");
    return `${trimmed}\n\n${block.replace(/\n$/, "")}\n`;
  }
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (/^\s*\[/.test(line)) break;
    end += 1;
  }
  const before = lines.slice(0, start);
  const after = lines.slice(end);
  const blockLines = block.replace(/\n$/, "").split("\n");
  return [...before, ...blockLines, ...after].join("\n").replace(/\n*$/, "\n");
}

function claudeDesktopPath(home: string): string {
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  }
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
}

function backupFile(filePath: string): void {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  fs.copyFileSync(filePath, `${filePath}.bak.${stamp}`);
}

function atomicWriteJson(filePath: string, doc: unknown): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function commandExists(bin: string): boolean {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of pathEnv.split(sep)) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext.toLowerCase());
      if (fs.existsSync(candidate)) return true;
      // Windows PATHEXT is usually uppercase; also try as-is
      const candidateRaw = path.join(dir, bin + ext);
      if (fs.existsSync(candidateRaw)) return true;
    }
  }
  return false;
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
