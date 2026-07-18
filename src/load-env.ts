/**
 * Load FIGMA_ACCESS_TOKEN (and other keys) from nearest `.env` / `.env.local`.
 * MCP often starts without the user's shell env — never write tokens into mcp.json.
 * Does not override variables already set in the process environment.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function loadNearestEnv(startDir: string = process.cwd()): string[] {
  const loaded: string[] = [];
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of [".env.local", ".env"]) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      applyEnvFile(file);
      loaded.push(file);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return loaded;
}

function applyEnvFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
