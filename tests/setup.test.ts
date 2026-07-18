import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  buildServerEntry,
  detectClients,
  resolveMcpBin,
  setupAgents,
  upsertTomlSection,
  wrapNpx,
} from "../src/setup.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-setup-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("buildServerEntry — cwd-independent package bin", () => {
  it("local mode uses absolute package bin …/bin/figma-fidelity.js mcp", () => {
    const entry = buildServerEntry("/pkg/figma-fidelity", "local");
    expect(entry.args).toEqual(["mcp"]);
    expect(entry.command.endsWith(path.join("bin", "figma-fidelity.js"))).toBe(true);
    expect(path.isAbsolute(entry.command)).toBe(true);
  });

  it("prefers project node_modules symlink over pnpm store realpath", () => {
    const project = path.join(tmp, "host-app");
    const store = path.join(tmp, ".pnpm", "figma-fidelity@hash", "node_modules", "figma-fidelity");
    const link = path.join(project, "node_modules", "figma-fidelity");
    fs.mkdirSync(path.join(store, "bin"), { recursive: true });
    fs.writeFileSync(path.join(store, "bin", "figma-fidelity.js"), "");
    fs.mkdirSync(path.join(project, "node_modules"), { recursive: true });
    fs.symlinkSync(store, link);

    const bin = resolveMcpBin(store, project);
    expect(bin).toBe(path.join(project, "node_modules", "figma-fidelity", "bin", "figma-fidelity.js"));
    expect(bin.includes(`${path.sep}.pnpm${path.sep}`)).toBe(false);

    const entry = buildServerEntry(store, "local", project);
    expect(entry.command).toBe(bin);
  });

  it("npx mode uses npx -y figma-fidelity mcp (published package)", () => {
    const entry = buildServerEntry("/pkg/figma-fidelity", "npx");
    expect(entry.args).toContain("-y");
    expect(entry.args).toContain("figma-fidelity");
    expect(entry.args.at(-1)).toBe("mcp");
  });

  it("wrapNpx uses cmd /c on win32 shape when forced", () => {
    // Unit the helper shape used on Windows without mutating process.platform.
    const entry = wrapNpx(["-y", "figma-fidelity", "mcp"]);
    expect(entry.args).toContain("figma-fidelity");
  });
});

describe("setupAgents — one CLI wires detected agents", () => {
  it("writes Cursor + Claude + Codex with backup; no token values", () => {
    const home = path.join(tmp, "home-a");
    const pkg = path.join(tmp, "pkg-a");
    // Pretend clients exist
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude.json"), "{}\n");
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), 'model = "x"\n');
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "cli.ts"), "");

    const result = setupAgents({
      homeDir: home,
      packageRoot: pkg,
      agents: ["cursor", "claude", "codex"],
    });

    expect(result.ok).toBe(true);
    expect(result.standardConfig.mcpServers["figma-fidelity"]).toBeTruthy();

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(cursor.mcpServers["figma-fidelity"]?.args).toContain("mcp");
    expect(JSON.stringify(cursor)).not.toMatch(/figd_|sk-/);

    const claude = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(claude.mcpServers["figma-fidelity"]).toBeTruthy();

    const codex = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    expect(codex).toContain("[mcp_servers.figma-fidelity]");
    // backup of previous toml
    const bak = fs.readdirSync(path.join(home, ".codex")).filter((f) => f.includes(".bak."));
    expect(bak.length).toBeGreaterThan(0);
  });

  it("merges without wiping existing mcpServers", () => {
    const home = path.join(tmp, "home-b");
    const pkg = path.join(tmp, "pkg-b");
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "cli.ts"), "");
    fs.writeFileSync(
      path.join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "echo", args: [] } } }),
    );

    setupAgents({ homeDir: home, packageRoot: pkg, agents: ["cursor"] });

    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cursor.mcpServers.other).toEqual({ command: "echo", args: [] });
    expect(cursor.mcpServers["figma-fidelity"]).toBeTruthy();
    // backup created
    expect(fs.readdirSync(path.join(home, ".cursor")).some((f) => f.includes(".bak."))).toBe(true);
  });

  it("--project writes Cursor + Claude + VS Code workspace configs", () => {
    const home = path.join(tmp, "home-c");
    const pkg = path.join(tmp, "pkg-c");
    const project = path.join(tmp, "project-c");
    fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "src", "cli.ts"), "");
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude.json"), "{}\n");

    const result = setupAgents({
      homeDir: home,
      packageRoot: pkg,
      projectRoot: project,
      project: true,
      agents: ["cursor", "claude", "vscode"],
    });

    expect(result.targets.some((t) => t.agent === "cursor-project")).toBe(true);
    expect(result.targets.some((t) => t.agent === "claude-project")).toBe(true);
    expect(result.targets.some((t) => t.agent === "vscode-project")).toBe(true);

    const vscode = JSON.parse(
      fs.readFileSync(path.join(project, ".vscode", "mcp.json"), "utf8"),
    ) as { servers: Record<string, { type: string; command: string }> };
    // VS Code schema uses `servers`, not `mcpServers`
    expect(vscode.servers["figma-fidelity"]?.type).toBe("stdio");
  });

  it("detectClients reports cursor when ~/.cursor exists", () => {
    const home = path.join(tmp, "home-d");
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    const list = detectClients(home, tmp);
    expect(list.find((c) => c.id === "cursor")?.present).toBe(true);
  });
});

describe("upsertTomlSection", () => {
  it("appends when missing", () => {
    const next = upsertTomlSection(
      'model = "x"\n',
      "[mcp_servers.figma-fidelity]",
      '[mcp_servers.figma-fidelity]\ncommand = "npx"\n',
    );
    expect(next).toContain('model = "x"');
    expect(next).toContain("[mcp_servers.figma-fidelity]");
  });

  it("replaces existing section", () => {
    const src = `[mcp_servers.other]\ncommand = "a"\n\n[mcp_servers.figma-fidelity]\ncommand = "old"\n\n[features]\nx = true\n`;
    const next = upsertTomlSection(
      src,
      "[mcp_servers.figma-fidelity]",
      '[mcp_servers.figma-fidelity]\ncommand = "new"\n',
    );
    expect(next).toContain('command = "new"');
    expect(next).not.toContain('command = "old"');
    expect(next).toContain("[mcp_servers.other]");
    expect(next).toContain("[features]");
  });
});
