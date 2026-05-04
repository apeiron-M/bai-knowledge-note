/**
 * Verify that all created documents have corresponding file nodes in the drive.
 * Repairs any missing nodes via ADD_FILE.
 *
 * This fixes a race condition where rapid MCP createDocument calls can
 * silently fail to add the file node to the drive tree.
 */

const MCP_URL = "http://localhost:4001/mcp";
let mcpId = 9000;

async function mcpCall(toolName, toolArgs) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
      id: ++mcpId,
    }),
  });

  const text = await res.text();
  const dataMatch = text.match(/^data:\s*(.+)$/m);
  if (!dataMatch) throw new Error(`MCP ${toolName}: no data in response`);

  const json = JSON.parse(dataMatch[1]);
  if (json.error) throw new Error(`MCP ${toolName}: ${json.error.message}`);

  const result = json.result;
  if (result?.structuredContent) return result.structuredContent;
  if (result?.content?.[0]?.text) return JSON.parse(result.content[0].text);
  return result;
}

/**
 * Verify all documents in titleToDocId exist as file nodes in the drive.
 * Add missing ones via ADD_FILE.
 *
 * @param {string} driveId - Drive UUID
 * @param {Map<string, string>} titleToDocId - Map of title → document ID
 * @param {string} documentType - e.g. "bai/knowledge-note" or "bai/research-claim"
 * @param {string|null} parentFolder - Folder ID to place missing nodes in
 * @returns {Promise<{ verified: number, repaired: number }>}
 */
export async function verifyDriveNodes(
  driveId,
  titleToDocId,
  documentType,
  parentFolder,
) {
  console.log("=== Verifying drive nodes ===\n");

  // Get current drive state
  const driveResult = await mcpCall("getDocument", { id: driveId });
  const nodes = driveResult?.document?.state?.global?.nodes ?? [];
  const existingNodeIds = new Set(
    nodes.filter((n) => n.kind === "file").map((n) => n.id),
  );

  // Find missing documents
  const missing = [];
  for (const [title, docId] of titleToDocId) {
    if (!existingNodeIds.has(docId)) {
      missing.push({ title, docId });
    }
  }

  if (missing.length === 0) {
    console.log(`All ${titleToDocId.size} documents verified in drive.\n`);
    return { verified: titleToDocId.size, repaired: 0 };
  }

  console.log(`Found ${missing.length} missing drive nodes. Repairing...\n`);

  // Batch ADD_FILE actions (max 20 per batch to avoid overwhelming)
  const batchSize = 20;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    const actions = batch.map(({ title, docId }) => {
      const input = {
        id: docId,
        name: title,
        documentType,
      };
      if (parentFolder) input.parentFolder = parentFolder;
      return { type: "ADD_FILE", input, scope: "global" };
    });

    await mcpCall("addActions", { documentId: driveId, actions });
    console.log(
      `  Repaired ${i + 1}-${Math.min(i + batchSize, missing.length)} of ${missing.length}`,
    );

    if (i + batchSize < missing.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\nRepaired ${missing.length} missing drive nodes.\n`);
  return {
    verified: titleToDocId.size - missing.length,
    repaired: missing.length,
  };
}
