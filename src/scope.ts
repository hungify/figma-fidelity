import type { ProfileName, RejectResult } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export interface ScopeInput {
  nodeId?: string;
  selector?: string;
  profile?: ProfileName;
  pageReason?: string;
}

/**
 * Default profile: nodeId/selector present → component/strict.
 * page is never inferred — it must be explicit AND carry a pageReason.
 */
export function resolveProfile(input: ScopeInput): ProfileName {
  if (input.profile) return input.profile;
  return "component/strict";
}

/**
 * Guard checks 1–2 (pure input validation, no DOM needed).
 * Runs before any capture/compare. Checks 3–4 (selector resolution) live in
 * capture.ts because they need the rendered DOM.
 */
export function validateScope(input: ScopeInput): RejectResult | null {
  const hasScope = Boolean(input.nodeId?.trim()) || Boolean(input.selector?.trim());
  if (!hasScope) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SCOPE_REQUIRED",
      message:
        "nodeId or selector required for component-level verify; refusing full-page fallback.",
    };
  }

  const profile = resolveProfile(input);
  if (profile === "page" && !input.pageReason?.trim()) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "PAGE_REASON_REQUIRED",
      message: "profile=page requires pageReason explaining why full-viewport verify is intended.",
    };
  }

  return null;
}
