import type { ExpectSize, ProfileName, RejectResult } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

export interface ScopeInput {
  nodeId?: string;
  selector?: string;
  profile?: ProfileName;
  pageReason?: string;
  expectSize?: ExpectSize;
}

const PAGE_ESCAPE_RE =
  /\b(alpha|transparenc|soft.?shadow|drop.?shadow|escape|dilut|full.?page.?ok|content.?crop|figma-gold-content)\b|(?<!full-)bleed/i;

/** page is never inferred. Scoped runs default to strict component verification. */
export function resolveProfile(input: ScopeInput): ProfileName {
  return input.profile ?? "component/strict";
}

/** Pure contract validation. Runs before capture or compare. */
export function validateScope(input: ScopeInput): RejectResult | null {
  const hasNodeId = Boolean(input.nodeId?.trim());
  const hasSelector = Boolean(input.selector?.trim());
  if (!hasNodeId && !hasSelector) {
    return reject(
      "SCOPE_REQUIRED",
      "nodeId and explicit DOM scope required; refusing implicit full-page fallback.",
    );
  }
  if (!hasNodeId) {
    return reject("NODE_ID_REQUIRED", "nodeId required to bind run evidence to Figma gold.");
  }

  const profile = resolveProfile(input);
  if (profile === "page") {
    const reason = input.pageReason?.trim();
    if (!reason) {
      return reject(
        "PAGE_REASON_REQUIRED",
        "profile=page requires pageReason explaining why full-viewport verify is intended.",
      );
    }
    if (PAGE_ESCAPE_RE.test(reason)) {
      return reject(
        "PAGE_REASON_FORBIDDEN",
        "pageReason attempts to bypass a content contract; use component/strict with selector.",
      );
    }
    if (hasSelector) {
      return reject(
        "PAGE_SELECTOR_FORBIDDEN",
        "profile=page cannot use selector; selector crops require a component profile.",
      );
    }
    if (input.expectSize) {
      return reject(
        "EXPECT_SIZE_FORBIDDEN",
        "profile=page cannot set expectSize; use component/strict for fixed content.",
      );
    }
    return null;
  }

  if (!hasSelector) {
    return reject(
      "SELECTOR_REQUIRED",
      "component profiles require unique DOM selector; nodeId alone cannot crop app DOM.",
    );
  }
  if (profile === "component/strict" && !input.expectSize) {
    return reject(
      "EXPECT_SIZE_REQUIRED",
      "component/strict requires expectSize from Figma metadata.",
    );
  }
  return null;
}

function reject(error: RejectResult["error"], message: string): RejectResult {
  return { schemaVersion: SCHEMA_VERSION, ok: false, error, message };
}
