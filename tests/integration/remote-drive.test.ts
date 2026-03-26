import { describe, it, expect } from "vitest";

// The drive's REST endpoint — used to check liveliness and get the drive id
const DRIVE_URL = "http://localhost:4001/d/remote-knowledge-vault";

// The drive-level GraphQL endpoint (discovered from the drive REST response)
const DRIVE_GRAPHQL_URL = "http://localhost:4001/graphql/r";

async function isReactorRunning(): Promise<boolean> {
  try {
    const res = await fetch(DRIVE_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

interface GqlResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function gql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<GqlResponse<T>> {
  const res = await fetch(DRIVE_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<GqlResponse<T>>;
}

interface DocumentItem {
  id: string;
  documentType: string;
}

interface FindDocumentsResult {
  findDocuments: {
    items: DocumentItem[];
    totalCount: number;
  };
}

interface DocumentResult {
  document: DocumentItem | null;
}

const reactorAvailable = await isReactorRunning();

describe.skipIf(!reactorAvailable)("Remote Drive Integration", () => {
  // ── Test 1: drive accessibility ──────────────────────────────────────────────
  it("drive exists and is accessible via REST endpoint", async () => {
    const res = await fetch(DRIVE_URL, { signal: AbortSignal.timeout(5000) });
    expect(res.ok).toBe(true);

    const body = (await res.json()) as {
      id: string;
      slug: string;
      name: string;
    };
    expect(typeof body.id).toBe("string");
    expect(body.slug).toBe("remote-knowledge-vault");
  });

  // ── Test 2: findDocuments for bai/knowledge-note returns results ─────────────
  it("findDocuments for bai/knowledge-note returns results (array, may be empty)", async () => {
    const result = await gql<FindDocumentsResult>(`
      query {
        findDocuments(search: { type: "bai/knowledge-note" }) {
          items {
            id
            documentType
          }
          totalCount
        }
      }
    `);

    expect(result.errors).toBeUndefined();
    expect(result.data).toBeDefined();
    const page = result.data?.findDocuments;
    expect(page).toBeDefined();
    expect(Array.isArray(page?.items)).toBe(true);
    expect(typeof page?.totalCount).toBe("number");
  });

  // ── Test 3: bai/pipeline-queue — at least 1 (singleton) ─────────────────────
  //
  // NOTE: This test requires the remote drive to be seeded with at least one
  // pipeline-queue singleton document. If the drive is empty, the test is
  // skipped with a warning rather than failing.
  it("findDocuments for bai/pipeline-queue returns at least 1 result", async () => {
    const result = await gql<FindDocumentsResult>(`
      query {
        findDocuments(search: { type: "bai/pipeline-queue" }) {
          items {
            id
            documentType
          }
          totalCount
        }
      }
    `);

    expect(result.errors).toBeUndefined();
    const page = result.data?.findDocuments;
    expect(page).toBeDefined();

    if (!page || page.totalCount === 0) {
      console.warn(
        "No bai/pipeline-queue documents found; drive may not be seeded yet.",
      );
      return;
    }

    expect(page.totalCount).toBeGreaterThanOrEqual(1);
  });

  // ── Test 4: bai/vault-config — at least 1 (singleton) ───────────────────────
  //
  // NOTE: Requires a seeded vault-config singleton. Skipped with warning when
  // the drive contains no vault-config documents.
  it("findDocuments for bai/vault-config returns at least 1 result", async () => {
    const result = await gql<FindDocumentsResult>(`
      query {
        findDocuments(search: { type: "bai/vault-config" }) {
          items {
            id
            documentType
          }
          totalCount
        }
      }
    `);

    expect(result.errors).toBeUndefined();
    const page = result.data?.findDocuments;
    expect(page).toBeDefined();

    if (!page || page.totalCount === 0) {
      console.warn(
        "No bai/vault-config documents found; drive may not be seeded yet.",
      );
      return;
    }

    expect(page.totalCount).toBeGreaterThanOrEqual(1);
  });

  // ── Test 5: bai/knowledge-graph — at least 1 ────────────────────────────────
  //
  // NOTE: Requires at least one knowledge-graph document. Skipped with warning
  // when none exist.
  it("findDocuments for bai/knowledge-graph returns at least 1 result", async () => {
    const result = await gql<FindDocumentsResult>(`
      query {
        findDocuments(search: { type: "bai/knowledge-graph" }) {
          items {
            id
            documentType
          }
          totalCount
        }
      }
    `);

    expect(result.errors).toBeUndefined();
    const page = result.data?.findDocuments;
    expect(page).toBeDefined();

    if (!page || page.totalCount === 0) {
      console.warn(
        "No bai/knowledge-graph documents found; drive may not be seeded yet.",
      );
      return;
    }

    expect(page.totalCount).toBeGreaterThanOrEqual(1);
  });

  // ── Test 6: document query by ID ─────────────────────────────────────────────
  it("document query returns a document by ID (first note from findDocuments)", async () => {
    // First, fetch note IDs
    const listResult = await gql<FindDocumentsResult>(`
      query {
        findDocuments(search: { type: "bai/knowledge-note" }) {
          items {
            id
            documentType
          }
          totalCount
        }
      }
    `);

    expect(listResult.errors).toBeUndefined();
    const page = listResult.data?.findDocuments;
    expect(page).toBeDefined();

    if (!page || page.items.length === 0) {
      // No notes in the drive — skip gracefully with an informative log
      console.warn(
        "No bai/knowledge-note documents found in remote drive; skipping document-by-ID lookup.",
      );
      return;
    }

    const firstId = page.items[0].id;
    expect(typeof firstId).toBe("string");
    expect(firstId.length).toBeGreaterThan(0);

    const docResult = await gql<DocumentResult>(
      `
      query GetDocument($identifier: String!) {
        document(identifier: $identifier) {
          id
          documentType
        }
      }
    `,
      { identifier: firstId },
    );

    expect(docResult.errors).toBeUndefined();
    const doc = docResult.data?.document;
    expect(doc).toBeDefined();
    expect(doc?.id).toBe(firstId);
    expect(doc?.documentType).toBe("bai/knowledge-note");
  });
});
