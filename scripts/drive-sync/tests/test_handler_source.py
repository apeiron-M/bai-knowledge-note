from lib.id_map import IdMap
from handlers.source import build_actions


def _idmap(tmp_path):
    return IdMap(tmp_path / "id-map.json")


def test_ingest_source_emitted_first(tmp_path):
    state = {
        "title": "T", "content": "C", "sourceType": "ARTICLE",
        "extractedClaims": [], "createdAt": "2026-01-01T00:00:00.000Z",
    }
    scalars, _ = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["type"] == "INGEST_SOURCE"
    assert scalars[0]["input"]["sourceType"] == "ARTICLE"


def test_default_source_type_is_manual_entry(tmp_path):
    state = {"title": "T", "content": "C", "extractedClaims": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    assert scalars[0]["input"]["sourceType"] == "MANUAL_ENTRY"


def test_provenance_fields_flatten_into_ingest_source(tmp_path):
    state = {
        "title": "T", "content": "C", "sourceType": "WEB_PAGE",
        "extractedClaims": [],
        "provenance": {"url": "https://x", "author": "a", "publishedAt": "2026-01-01T00:00:00.000Z",
                       "method": "scrape", "tool": "puppeteer"},
    }
    scalars, _ = build_actions(state, _idmap(tmp_path))
    inp = scalars[0]["input"]
    assert inp["url"] == "https://x"
    assert inp["author"] == "a"
    assert inp["method"] == "scrape"


def test_status_emitted_when_present(tmp_path):
    state = {"title": "T", "content": "C", "status": "EXTRACTED", "extractedClaims": []}
    scalars, _ = build_actions(state, _idmap(tmp_path))
    statuses = [a for a in scalars if a["type"] == "SET_SOURCE_STATUS"]
    assert len(statuses) == 1
    assert statuses[0]["input"]["status"] == "EXTRACTED"


def test_extraction_stats_emitted_when_present(tmp_path):
    state = {
        "title": "T", "content": "C", "extractedClaims": [],
        "extractionStats": {"claimCount": 10, "skippedCount": 2, "skipRate": 0.2,
                            "extractedAt": "2026-01-01T00:00:00.000Z"},
    }
    scalars, _ = build_actions(state, _idmap(tmp_path))
    stats = [a for a in scalars if a["type"] == "RECORD_EXTRACTION_STATS"]
    assert len(stats) == 1
    assert stats[0]["input"]["claimCount"] == 10


def test_extracted_claims_deferred_to_crossrefs(tmp_path):
    id_map = _idmap(tmp_path)
    id_map.set("c1", "C1")
    state = {"title": "T", "content": "C", "extractedClaims": ["c1", "missing"]}
    _, crossrefs = build_actions(state, id_map, drop_unmapped=True)
    assert len(crossrefs) == 1
    assert crossrefs[0]["input"]["claimRef"] == "C1"
