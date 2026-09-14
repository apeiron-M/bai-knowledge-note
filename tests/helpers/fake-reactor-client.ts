import { vi } from "vitest";
import type { HttpRouteDeps } from "../../subgraphs/http/lib/deps.js";

export function createFakeReactorClient(
  overrides: Partial<HttpRouteDeps["reactorClient"]> = {},
): HttpRouteDeps["reactorClient"] {
  return {
    get: vi.fn(async () => ({
      header: {
        id: "doc",
        documentType: "bai/source",
        revision: { global: 0, document: 0 },
      },
      state: { global: {} },
    })) as never,
    getOperations: vi.fn(async () => ({ results: [] })) as never,
    execute: vi.fn(async () => ({})) as never,
    executeAsync: vi.fn(async () => ({ id: "job-1" })) as never,
    waitForJob: vi.fn(async () => ({
      id: "job-1",
      status: "READ_READY",
      error: null,
    })) as never,
    find: vi.fn(async () => ({ results: [] })) as never,
    createDocumentInDrive: vi.fn(async () => ({
      header: {
        id: "new-doc",
        documentType: "bai/source",
        revision: { document: 2 },
      },
      state: { global: {} },
    })) as never,
    create: vi.fn(async (document: unknown) => document) as never,
    deleteDocuments: vi.fn(async () => undefined) as never,
    getDocumentModelModule: vi.fn(async () => ({
      utils: {
        createDocument: () => ({
          header: {
            id: "new-doc",
            documentType: "bai/source",
            name: "",
            revision: {},
          },
          state: { global: {} },
        }),
      },
    })) as never,
    ...overrides,
  };
}