import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";

/**
 * Conversion is an HTTP capability — GraphQL cannot carry a file body — so the
 * schema exposes readiness only: enough for a client to know whether the
 * capability is live, and what the backend can read, without issuing an upload.
 *
 * The shape is the generator's: a namespace type reached from the root
 * (`type Query { convert: ConvertQueries! }`), not flat root fields. The stub
 * shipped `example(driveId: String!)`; this replaces it.
 */
export const schema: DocumentNode = gql`
  """
  Whether a conversion backend is configured, and what it can do.
  """
  type ConvertHealth {
    """True when a backend answered."""
    ok: Boolean!
    """Identifies the engine, e.g. "docling.rs". Null when nothing answered."""
    backend: String
    """True when the backend can convert PDFs — i.e. its models are present."""
    ready: Boolean!
    """The assets a not-ready backend is missing, as it reports them."""
    missing: [String!]!
    """The format ids this backend reads (docling-rs serves 29)."""
    formats: [String!]!
    """
    False when CONVERT_SERVICE_URL is unset. Distinct from ok: a vault with no
    conversion service is a working vault, so this is a state, not a failure.
    """
    configured: Boolean!
  }

  type ConvertQueries {
    """Readiness of the conversion backend behind this subgraph."""
    health: ConvertHealth!
  }

  type Query {
    convert: ConvertQueries!
  }
`;
