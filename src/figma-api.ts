/**
 * Minimal Figma REST metadata access shared by staleness + spec-gate.
 * Token is header-only, never logged/persisted (see "Token handling").
 */
export interface NodeMetadata {
  lastModified: string | null;
  absoluteBoundingBox: { width: number; height: number } | null;
}

export async function getNodeMetadata(
  fileKey: string,
  nodeId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NodeMetadata | { error: string }> {
  try {
    const res = await fetchImpl(
      `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`,
      { headers: { "X-Figma-Token": token } },
    );
    if (!res.ok) {
      return { error: `Figma metadata call returned HTTP ${res.status}.` };
    }
    const json = (await res.json()) as {
      lastModified?: string;
      nodes?: Record<
        string,
        { document?: { absoluteBoundingBox?: { width: number; height: number } } } | null
      >;
    };
    const node = json.nodes?.[nodeId];
    if (!node) {
      return { error: `Figma metadata call returned no node for "${nodeId}".` };
    }
    return {
      lastModified: json.lastModified ?? null,
      absoluteBoundingBox: node.document?.absoluteBoundingBox ?? null,
    };
  } catch {
    return { error: "network error during Figma metadata call." };
  }
}
