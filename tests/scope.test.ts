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

  it("NODE_ID_REQUIRED when only selector is present", () => {
    const r = validateScope({ selector: "[data-testid=auth.login]" });
    expect(r?.error).toBe("NODE_ID_REQUIRED");
  });

  it("SELECTOR_REQUIRED when component run has only nodeId", () => {
    const r = validateScope({
      nodeId: "153:5181",
      expectSize: { width: 544, height: 464 },
    });
    expect(r?.error).toBe("SELECTOR_REQUIRED");
  });

  it("component/strict requires expectSize", () => {
    const r = validateScope({
      nodeId: "153:5181",
      selector: "[data-testid=auth.login]",
    });
    expect(r?.error).toBe("EXPECT_SIZE_REQUIRED");
  });

  it("page rejects selector crop and escape reasons", () => {
    expect(
      validateScope({
        nodeId: "153:2364",
        profile: "page",
        pageReason: "desktop full viewport with header and footer",
        selector: "[data-testid=auth.login]",
      })?.error,
    ).toBe("PAGE_SELECTOR_FORBIDDEN");
    expect(
      validateScope({
        nodeId: "153:2364",
        profile: "page",
        pageReason: "content crop has soft shadow",
      })?.error,
    ).toBe("PAGE_REASON_FORBIDDEN");
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
    expect(
      validateScope({
        nodeId: "153:5181",
        selector: "[data-testid=auth.login]",
        expectSize: { width: 544, height: 464 },
      }),
    ).toBeNull();
  });
});
