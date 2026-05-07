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

        req = Request(
            self.endpoint,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode())
        except HTTPError as e:
            raise GraphQLError(f"HTTP {e.code} from {self.endpoint}: {e.reason}") from e
        except URLError as e:
            raise GraphQLError(f"Network error to {self.endpoint}: {e.reason}") from e

        errors = payload.get("errors")
        if errors:
            messages = "; ".join(e.get("message", "?") for e in errors)
            raise GraphQLError(f"GraphQL errors: {messages}")

        return payload.get("data", {})
