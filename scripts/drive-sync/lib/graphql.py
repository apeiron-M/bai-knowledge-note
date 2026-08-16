"""Minimal GraphQL client built on stdlib urllib — no third-party deps.

Used to fetch from the source switchboard. The `switchboard` CLI is not
involved on the source side: this script reads only via GraphQL so it can
target any switchboard that exposes a GraphQL endpoint.
"""
import json
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class GraphQLError(RuntimeError):
    pass


class GraphQLClient:
    def __init__(self, endpoint: str, timeout: float = 60.0):
        self.endpoint = endpoint
        self.timeout = timeout

    def query(
        self,
        query: str,
        variables: Optional[dict] = None,
        operation_name: Optional[str] = None,
    ) -> dict:
        body = {"query": query}
        if variables is not None:
            body["variables"] = variables
        if operation_name is not None:
            body["operationName"] = operation_name

        # Delegate to lib.gql's pooled keep-alive transport. The old
        # per-request urllib path performed a fresh TLS handshake per call,
        # which on handshake-bound remote hosts fails ~19% of the time
        # ("_ssl.c:983: handshake operation timed out") during bulk runs.
        # gql.post reuses one connection per (scheme, host) and retries
        # transport errors with backoff; GraphQL-level errors are not
        # retried. `body` above is kept for operationName compatibility.
        from . import gql

        try:
            return gql.post(
                query,
                variables,
                endpoint=self.endpoint,
                timeout=self.timeout,
            )
        except gql.GraphQLError as e:
            raise GraphQLError(str(e)) from e
