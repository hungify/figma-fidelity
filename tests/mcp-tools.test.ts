import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createFidelityMcpServer } from "../src/mcp.ts";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function listToolNames(includeDebugTools: boolean): Promise<string[]> {
  const server = createFidelityMcpServer({ includeDebugTools });
  const client = new Client({ name: "figma-fidelity-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.listTools();
  return result.tools.map((tool) => tool.name).sort();
}

describe("MCP tool disclosure", () => {
  it("exposes only primary workflow tools by default", async () => {
    await expect(listToolNames(false)).resolves.toEqual([
      "fidelity_done_gate",
      "fidelity_fetch_gold",
      "fidelity_run",
    ]);
  });

  it("adds low-level capture and compare tools only in debug mode", async () => {
    await expect(listToolNames(true)).resolves.toEqual([
      "fidelity_capture",
      "fidelity_compare",
      "fidelity_done_gate",
      "fidelity_fetch_gold",
      "fidelity_run",
    ]);
  });
});
