import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  type AccessGrant {
    documentId: ID!
    documentTitle: String
    documentType: String
    userAddress: String!
    permission: String!
    grantedBy: String
  }

  type AccessProtection {
    documentId: ID!
    documentTitle: String
    protected: Boolean!
    ownerAddress: String
  }

  type AccessOperationGrant {
    documentId: ID!
    documentTitle: String
    operationType: String!
    userAddress: String!
  }

  """
  Who has access to what, in one query.

  The host owns the address-to-document relation but exposes it only one
  document at a time, or for the calling user alone. Answering "who has access
  to what" from a client therefore cost one request per document — around 1,500
  round trips on a full vault. This reads the same tables server-side.
  """
  type AccessMap {
    """
    False when the Switchboard runs without document permissions enabled: the
    tables do not exist and every list below is empty. Callers should report
    that authorization is off rather than that nobody has access.
    """
    available: Boolean!
    """Grants on the drive itself. These reach every document by inheritance."""
    driveGrants: [AccessGrant!]!
    """Grants set on individual documents."""
    documentGrants: [AccessGrant!]!
    """Documents carrying their own protection row."""
    protections: [AccessProtection!]!
    """
    Per-operation restrictions. The existence of any row restricts that
    operation on that document to the addresses listed.
    """
    operationGrants: [AccessOperationGrant!]!
    distinctAddresses: Int!
    documentsWithOwnGrants: Int!
  }

  extend type Query {
    """
    Every grant, protection and operation restriction in a drive, in one call.
    Requires ADMIN of the drive: it publishes the whole access list.
    """
    accessMap(driveId: ID!): AccessMap!

    """
    Whether the caller administers this document — the host's own canManage
    predicate: supreme admin, owner, or an ADMIN grant. Anonymous callers get
    false.

    A boolean, so asking has no side effects. The host's documentAccess answers
    the same question but by REFUSING, and it logs every refusal as an error —
    so probing it to decide whether to show an admin menu wrote an error line
    into the Switchboard log for every non-admin session.
    """
    canManage(documentId: ID!): Boolean!
  }
`;
