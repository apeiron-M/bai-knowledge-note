/**
 * What `#browser-vault` (package.json "imports") resolves to everywhere but a
 * browser build. The browser vault exists only for knowledge-vault-landing's
 * "Try on web"; the Switchboard, Connect and the desktop app never run it, and
 * convert files through the Docling service behind subgraphs/convert.
 *
 * Keeping it out of the server build is what lets the Switchboard load this
 * package at all. The server build lists every package that needs a WebAssembly
 * module or a native addon in the manifest's `externalDependencies`, and the
 * Switchboard's registry loader refuses the subgraphs and processors of a
 * package whose externals it has not installed. 1.0.54-dev.41 carried the browser
 * vault into the server build: on the cloud it loaded document models only — no
 * knowledgeGraph, no REST routes, no graph indexer.
 */
export {};

throw new Error(
  "The browser vault runs only in a browser build (knowledge-vault-landing's Try on web). " +
    "The Switchboard, Connect and the desktop app convert files through the Docling service (subgraphs/convert).",
);
