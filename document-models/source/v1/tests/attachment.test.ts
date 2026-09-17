import { describe, expect, it } from "vitest";
import {
  attachOriginalFile,
  type AttachOriginalFileInput,
  ingestSource,
  IngestSourceInputSchema,
  reducer,
  type SourceState,
  utils,
} from "document-models/source/v1";
import { generateMock } from "document-model/mock";

/**
 * `bai/source` gained `originalFile` and friends so the artefact a source was
 * converted from survives ingestion instead of being discarded. The generated
 * test covers "the operation is recorded"; these cover the behaviour that
 * matters — what the state ends up holding, and what happens on the second
 * attach.
 */

/** The branded `attachment://v<n>:<hash>` ref type, as stored on the source. */
type AttachmentRef = NonNullable<SourceState["originalFile"]>;

const REF_A: AttachmentRef = `attachment://v1:${"a".repeat(64)}`;
const REF_B: AttachmentRef = `attachment://v1:${"b".repeat(64)}`;

const attachInput = (
  overrides: Partial<AttachOriginalFileInput> = {},
): AttachOriginalFileInput => ({
  originalFile: REF_A,
  originalFileName: "Design for How People Think.pdf",
  originalMimeType: "application/pdf",
  originalSizeBytes: 17_387_337,
  convertedBy: "docling.rs 1.55.0",
  attachedAt: "2026-09-17T17:30:00.000Z",
  ...overrides,
});

const ingested = () => reducer(utils.createDocument(), ingestSource(generateMock(IngestSourceInputSchema())));

describe("attachOriginalFile", () => {
  it("records the attachment and its metadata on an ingested source", () => {
    const doc = reducer(ingested(), attachOriginalFile(attachInput()));

    expect(doc.operations.global).toHaveLength(2);
    expect(doc.operations.global[1].error).toBeUndefined();
    expect(doc.state.global.originalFile).toBe(REF_A);
    expect(doc.state.global.originalFileName).toBe("Design for How People Think.pdf");
    expect(doc.state.global.originalMimeType).toBe("application/pdf");
    expect(doc.state.global.originalSizeBytes).toBe(17_387_337);
    expect(doc.state.global.originalAttachedAt).toBe("2026-09-17T17:30:00.000Z");
    expect(doc.state.global.convertedBy).toBe("docling.rs 1.55.0");
  });

  it("leaves the optional metadata null when only the ref is given", () => {
    // The `|| null` fallbacks: an attachment with no file name, type or
    // converting tool is still a valid attachment.
    const doc = reducer(
      ingested(),
      attachOriginalFile({
        originalFile: REF_A,
        attachedAt: "2026-09-17T17:30:00.000Z",
      }),
    );

    expect(doc.operations.global[1].error).toBeUndefined();
    expect(doc.state.global.originalFile).toBe(REF_A);
    expect(doc.state.global.originalFileName).toBeNull();
    expect(doc.state.global.originalMimeType).toBeNull();
    expect(doc.state.global.originalSizeBytes).toBeNull();
    expect(doc.state.global.convertedBy).toBeNull();
  });

  it("keeps a zero byte size as zero rather than coercing it to null", () => {
    // `0` is falsy but valid. With `|| null` this silently became null; the
    // reducer uses `?? null` for the numeric field so the value survives.
    const doc = reducer(ingested(), attachOriginalFile(attachInput({ originalSizeBytes: 0 })));

    expect(doc.operations.global[1].error).toBeUndefined();
    expect(doc.state.global.originalSizeBytes).toBe(0);
  });

  it("is idempotent when the same ref is attached twice", () => {
    // Content-addressed refs mean a re-dispatch of the same file is the same
    // ref, not a replacement — so it must not be treated as an attempt to swap.
    const once = reducer(ingested(), attachOriginalFile(attachInput()));
    const twice = reducer(once, attachOriginalFile(attachInput({ convertedBy: "docling.rs 1.56.0" })));

    expect(twice.operations.global[2].error).toBeUndefined();
    expect(twice.state.global.originalFile).toBe(REF_A);
    expect(twice.state.global.convertedBy).toBe("docling.rs 1.56.0");
  });

  it("refuses to replace an existing original with a different ref, and does not mutate state", () => {
    // The vault's premise: the source is the unrecoverable anchor. Silently
    // swapping the artefact under a set of derived claims would break the
    // provenance the whole model exists to preserve.
    const once = reducer(ingested(), attachOriginalFile(attachInput()));
    const before = once.state.global;

    const twice = reducer(once, attachOriginalFile(attachInput({ originalFile: REF_B })));

    // CLAUDE.md: a throwing reducer records the error on the operation and
    // leaves state untouched — never assert with toThrow().
    expect(twice.operations.global[2].error).toBe(
      "This source already has an original file; attach it again only with the same ref",
    );
    expect(twice.state.global.originalFile).toBe(REF_A);
    expect(twice.state.global).toStrictEqual(before);
  });

  it("attaches to a source that was never ingested", () => {
    // Nothing requires ingestion first: a source created empty can take an
    // original file as its first act.
    const doc = reducer(utils.createDocument(), attachOriginalFile(attachInput()));

    expect(doc.operations.global).toHaveLength(1);
    expect(doc.operations.global[0].error).toBeUndefined();
    expect(doc.state.global.originalFile).toBe(REF_A);
    expect(doc.state.global.status).toBe("INBOX");
  });
});