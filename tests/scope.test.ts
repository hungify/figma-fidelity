import { describe, expect, it } from "vitest";

import { resolveProfile, validateScope } from "../src/index.ts";

describe("scope guard (checks 1–2, pure input)", () => {
  it("SCOPE_REQUIRED when neither nodeId nor selector present", () => {
    const r = validateScope({});
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe("SCOPE_REQUIRED");
  });

  it("SCOPE_REQUIRED for whitespace-only values", () => {
    const r = validateScope({ nodeId: "  ", selector: "" });
    expect(r?.error).toBe("SCOPE_REQUIRED");
  });

  it("PAGE_REASON_REQUIRED when profile=page without pageReason", () => {
    const r = validateScope({ nodeId: "153:5181", profile: "page" });
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe("PAGE_REASON_REQUIRED");
  });

  it("page profile with pageReason passes scope validation", () => {
    const r = validateScope({
      nodeId: "153:5181",
      profile: "page",
      pageReason: "mobile full-bleed layout, no isolable content frame",
    });
    expect(r).toBeNull();
  });

  it("checks run in order: SCOPE_REQUIRED before PAGE_REASON_REQUIRED", () => {
    const r = validateScope({ profile: "page" });
    expect(r?.error).toBe("SCOPE_REQUIRED");
  });

  it("nodeId/selector present defaults to component/strict; page is never inferred", () => {
    expect(resolveProfile({ nodeId: "153:5181" })).toBe("component/strict");
    expect(resolveProfile({ selector: "[data-testid=auth.login]" })).toBe("component/strict");
    expect(resolveProfile({ nodeId: "153:5181", profile: "page" })).toBe("page");
  });

  it("valid component input passes", () => {
    expect(validateScope({ selector: "[data-testid=auth.login]" })).toBeNull();
  });
});
