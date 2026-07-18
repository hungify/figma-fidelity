import * as path from "node:path";

/**
 * Resolve artifact paths for MCP/CLI. Relative paths are against `cwd`
 * (default `process.cwd()`). Cursor MCP often starts with a non-repo cwd —
 * agents should pass absolute paths; this still makes relative paths usable
 * when the server is launched from the project root.
 */
export function resolveArtifactPath(input: string, cwd: string = process.cwd()): string {
  if (!input) return input;
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(cwd, input);
}
