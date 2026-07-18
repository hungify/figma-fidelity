# figma-fidelity

MCP-first visual fidelity engine for Figma → code.

Compares a Figma gold render against a live app capture with multi-signal checks, enforced content scope, and artifact-gated “done” — so agents cannot report a visual pass from a stale or diluted full-page score.

This repository is independent. Consume it from any app (via git/npm dependency or local clone). It does not require or import from a host application.

## Requirements

- Node.js 20+
- pnpm (or npm/yarn)
- Playwright browsers (`pnpm exec playwright install chromium`)
- `FIGMA_ACCESS_TOKEN` for gold fetch / staleness / spec-gate

## Quick start

```bash
git clone git@github.com:hungify/figma-fidelity.git
cd figma-fidelity
pnpm install
pnpm exec playwright install chromium
pnpm setup
```

`pnpm setup` merges a stdio MCP entry into every detected client (Cursor, Claude Code, Claude Desktop, Codex; VS Code with `--project`). Existing servers are preserved. Configs are backed up (`*.bak.<timestamp>`). Token values are never written into config files.

```bash
pnpm setup --project          # also write workspace MCP configs in the current project
pnpm exec figma-fidelity detect
pnpm setup --dry-run
```

| Flag | Description |
| --- | --- |
| `--project` | Write `.cursor/mcp.json`, `.mcp.json`, `.vscode/mcp.json` in the current working directory |
| `--agents cursor,claude,…` | Limit clients: `cursor`, `claude`, `claude-desktop`, `codex`, `vscode` |
| `--launch local` | Absolute `…/bin/figma-fidelity.js mcp` (default; cwd-safe) |
| `--launch npx` | `npx -y figma-fidelity mcp` (after npm publish) |
| `--force` | Write even if the client was not detected |
| `--dry-run` | Print planned writes without changing files |

### Manual MCP config

Prefer `pnpm setup` / `pnpm exec figma-fidelity setup --project` — it writes the same shape.

Installed as a dependency (or after clone + `pnpm install`):

```json
{
  "mcpServers": {
    "figma-fidelity": {
      "command": "/abs/path/to/app/node_modules/figma-fidelity/bin/figma-fidelity.js",
      "args": ["mcp"]
    }
  }
}
```

(`setup` prefers this host `node_modules/…` path — not the pnpm `.pnpm@hash` store path.)

After npm publish (`--launch npx`):

```json
{
  "mcpServers": {
    "figma-fidelity": {
      "command": "npx",
      "args": ["-y", "figma-fidelity", "mcp"]
    }
  }
}
```

Client CLIs:

```bash
claude mcp add figma-fidelity -- /absolute/path/to/node_modules/figma-fidelity/bin/figma-fidelity.js mcp
codex mcp add figma-fidelity -- /absolute/path/to/node_modules/figma-fidelity/bin/figma-fidelity.js mcp
```

Reload MCP. Ensure `FIGMA_ACCESS_TOKEN` is in the agent environment.

### Use as a library in another app

```bash
pnpm add github:hungify/figma-fidelity
# or, after publish: pnpm add figma-fidelity
```

```ts
import { run, fetchGold, checkDoneGate } from "figma-fidelity";
```

Artifact paths are chosen by the host app — this package does not assume any project layout.

## MCP tools

| Tool | Description |
| --- | --- |
| `fidelity_fetch_gold` | Figma Images API → gold PNG + `figma-gold.meta.json` |
| `fidelity_capture` | Hardened Playwright capture + selector uniqueness guards |
| `fidelity_compare` | Gold vs actual (area-gap → pixel → SSIM → ΔE2000) |
| `fidelity_run` | Full guarded loop: scope → capture → compare → artifacts |
| `fidelity_done_gate` | Per-viewport done check against `visual-score.json` |

Every verify call requires `nodeId` or `selector`, and `viewport`. `profile=page` also requires `pageReason`. Prefer `fidelity_run` for the agent loop.

## How it works

1. **Scope guards** (before capture/compare): `SCOPE_REQUIRED` → `PAGE_REASON_REQUIRED` → `SELECTOR_NOT_FOUND` → `SELECTOR_AMBIGUOUS`
2. **Compare pipeline**: area-gap pre-check → pixelmatch → SSIM → CIEDE2000 → optional cluster (page profile)
3. **Pass/fail**: per-signal thresholds only — `fidelityScore` is rank-only, never a gate
4. **Stability**: `runType: "final"` re-captures; `borderline` does not flip `pass` but blocks the done gate
5. **Spec gate**: live DOM box vs current Figma `absoluteBoundingBox` (warn + skip on network/token errors)
6. **Done gate**: `pass: true` + `runType: "final"` + fresh `capturedAt` + matching `nodeId` + `stability: "stable"` per viewport

`fetch-gold` failures never fail `fidelity_run`. Runs always use gold already on disk.

## Profiles

Defined in [`src/profiles.ts`](src/profiles.ts). Threshold changes are human-review only. Optional: `git config core.hooksPath .githooks`.

| Profile | minMatch | maxDiffPixels | minSSIM | maxAvgDeltaE | maxAreaGap |
| --- | --- | --- | --- | --- | --- |
| `page` | 0.99 | — | 0.97 | 4.0 | 5% |
| `component/strict` | 0.995 | 500 | 0.985 | 3.0 | 2% |
| `component/dev` | 0.98 | 2000 | 0.96 | 5.0 | 5% |

Default is `component/strict` when `nodeId` / `selector` is present. `page` must be explicit with `pageReason`.

## CLI

MCP is the primary interface. CLI is for smoke tests:

```bash
pnpm exec figma-fidelity fetch-gold \
  --file-key <key> --node-id <id> --out ./artifacts/login/desktop/figma-gold.png

pnpm exec figma-fidelity run \
  --url http://localhost:3000/login \
  --viewport desktop \
  --viewport-size 1440x1024 \
  --gold ./artifacts/login/desktop/figma-gold.png \
  --out-dir ./artifacts/login/desktop \
  --selector '[data-testid=auth.login]' \
  --run-type final

pnpm exec figma-fidelity done-gate \
  --node-id 153:5181 \
  --viewport desktop --out-dir ./artifacts/login/desktop
```

Exit codes: `0` success/pass, `1` fail, `2` usage or config error.

## Programmatic API

```ts
import { run, fetchGold, checkDoneGate } from "figma-fidelity";

await fetchGold({
  fileKey: "…",
  nodeId: "153:5181",
  outPath: "./artifacts/login/desktop/figma-gold.png",
});

const result = await run({
  url: "http://localhost:3000/login",
  nodeId: "153:5181",
  selector: "[data-testid=auth.login]",
  viewport: "desktop",
  viewportSize: { width: 1440, height: 1024 },
  goldPath: "./artifacts/login/desktop/figma-gold.png",
  outDir: "./artifacts/login/desktop",
  expectSize: { width: 544, height: 464 },
  runType: "final",
});

const done = checkDoneGate({
  nodeId: "153:5181",
  viewports: [
    { viewport: "desktop", outDir: "./artifacts/login/desktop" },
    { viewport: "mobile", outDir: "./artifacts/login/mobile" },
  ],
});
```

## Development

```bash
pnpm install
pnpm test
pnpm exec tsc --noEmit
```

## License

Private — see repository owner.
