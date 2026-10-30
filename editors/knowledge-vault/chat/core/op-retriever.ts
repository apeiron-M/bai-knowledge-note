// Moved to nl-runtime in M1 (core/op-retriever): `tokenize`, `retrievalText`
// and `RetrievedOp`. This shim keeps the old path for its test importers.
// The v1 lexical retriever (`createOpRetriever`) was removed in M5.
export { retrievalText, type RetrievedOp, tokenize } from "nl-runtime";
