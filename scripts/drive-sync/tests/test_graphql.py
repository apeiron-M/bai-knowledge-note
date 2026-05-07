"""Tests for GraphQL client — uses urllib mocking so no network needed."""
import json
from unittest.mock import patch, MagicMock
import pytest
from lib.graphql import GraphQLClient, GraphQLError


def _mock_urlopen(payload, status=200):
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode()
    resp.status = status
    resp.__enter__ = lambda self: self
    resp.__exit__ = lambda self, *a: None
    return resp


def test_query_returns_data_field():
    client = GraphQLClient("https://example.test/graphql")
    with patch("lib.graphql.urlopen", return_value=_mock_urlopen({"data": {"foo": 1}})):
        result = client.query("{ foo }")
    assert result == {"foo": 1}


def test_query_raises_on_graphql_errors():
    client = GraphQLClient("https://example.test/graphql")
    payload = {"errors": [{"message": "bad query"}]}
    with patch("lib.graphql.urlopen", return_value=_mock_urlopen(payload)):
        with pytest.raises(GraphQLError) as exc:
            client.query("{ broken }")
    assert "bad query" in str(exc.value)


def test_query_passes_variables():
    captured = {}
    def fake_urlopen(req, **kw):
        captured["body"] = json.loads(req.data.decode())
        return _mock_urlopen({"data": {"ok": True}})
    client = GraphQLClient("https://example.test/graphql")
    with patch("lib.graphql.urlopen", side_effect=fake_urlopen):
        client.query("query Q($id: String!) { document(identifier: $id) { id } }", {"id": "abc"})
    assert captured["body"]["query"].startswith("query Q")
    assert captured["body"]["variables"] == {"id": "abc"}


def test_query_includes_operation_name_when_provided():
    captured = {}
    def fake_urlopen(req, **kw):
        captured["body"] = json.loads(req.data.decode())
        return _mock_urlopen({"data": {"ok": True}})
    client = GraphQLClient("https://example.test/graphql")
    with patch("lib.graphql.urlopen", side_effect=fake_urlopen):
        client.query("{ ok }", operation_name="GetOk")
    assert captured["body"]["operationName"] == "GetOk"
