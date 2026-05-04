#!/usr/bin/env python3
"""
Import a downloaded Powerhouse vault (.phd files) into a local reactor via MCP.

Usage:
    python3 scripts/import-vault.py <drive-id> [vault-dir]

This script:
1. Creates folder structure in the target drive
2. Creates all documents, building old_id -> new_id map
3. Populates each document's state via MCP addActions
4. Remaps all cross-document references (links, MOC noteRefs, etc.)
"""

import json
import os
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone

# ─── Config ───

MCP_URL = os.environ.get("MCP_URL", "http://localhost:4001/mcp")
VAULT_DIR = "powerhouse vault"
DELAY_MS = 150  # ms between createDocument calls

# ─── MCP Client ───

_msg_id = 0

def mcp_call(method: str, params: dict | None = None):
    """Make a JSON-RPC call to the MCP server."""
    global _msg_id
    _msg_id += 1
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "id": _msg_id,
    }
    if params:
        payload["params"] = params

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        MCP_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode()
            # MCP may return SSE or JSON
            if body.startswith("event:") or body.startswith("data:"):
                # Parse SSE - find the last data line with JSON
                result = None
                for line in body.split("\n"):
                    if line.startswith("data:"):
                        try:
                            result = json.loads(line[5:].strip())
                        except json.JSONDecodeError:
                            pass
                return result
            else:
                return json.loads(body)
    except Exception as e:
        print(f"  MCP ERROR: {e}")
        return None


def mcp_tool(tool_name: str, args: dict):
    """Call an MCP tool and return the result content."""
    resp = mcp_call("tools/call", {"name": tool_name, "arguments": args})
    if not resp:
        return None
    if "error" in resp:
        print(f"  Tool error: {resp['error']}")
        return None
    result = resp.get("result", {})
    content = result.get("content", [])
    if content and content[0].get("type") == "text":
        try:
            return json.loads(content[0]["text"])
        except json.JSONDecodeError:
            return content[0]["text"]
    return result


def create_document(drive_id: str, doc_type: str, name: str, parent_folder: str | None = None) -> str | None:
    """Create a document and return its new ID."""
    args = {
        "documentType": doc_type,
        "driveId": drive_id,
        "name": name,
    }
    if parent_folder:
        args["parentFolder"] = parent_folder

    result = mcp_tool("createDocument", args)
    if result and isinstance(result, dict):
        return result.get("id") or result.get("documentId")
    return None


def add_actions(doc_id: str, actions: list) -> bool:
    """Dispatch actions to a document."""
    result = mcp_tool("addActions", {
        "documentId": doc_id,
        "actions": actions,
    })
    return result is not None


def add_drive_folder(drive_id: str, folder_name: str, parent_folder: str | None = None) -> str | None:
    """Add a folder to a drive via ADD_FOLDER action."""
    import hashlib
    folder_id = hashlib.md5(f"{drive_id}/{parent_folder or 'root'}/{folder_name}".encode()).hexdigest()[:12]

    action_input = {
        "id": folder_id,
        "name": folder_name,
    }
    if parent_folder:
        action_input["parentFolder"] = parent_folder

    result = mcp_tool("addActions", {
        "documentId": drive_id,
        "actions": [{
            "type": "ADD_FOLDER",
            "input": action_input,
            "scope": "global",
        }],
    })
    if result is not None:
        return folder_id
    return None


# ─── PHD File Parser ───

def parse_phd(path: str) -> dict:
    """Parse a .phd file and return header + state."""
    with zipfile.ZipFile(path, "r") as z:
        header = json.loads(z.read("header.json"))
        state = json.loads(z.read("state.json"))
    return {"header": header, "state": state, "path": path}


# ─── Document Populators ───

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def populate_knowledge_note(doc_id: str, state: dict, id_map: dict):
    """Populate a knowledge-note document from its state."""
    g = state.get("global", {})
    actions = []

    # Batch 1: Content fields
    if g.get("title"):
        actions.append({
            "type": "SET_TITLE",
            "input": {"title": g["title"], "updatedAt": now_iso()},
            "scope": "global",
        })

    if g.get("description"):
        # Truncate to 200 chars
        desc = g["description"][:200]
        actions.append({
            "type": "SET_DESCRIPTION",
            "input": {"description": desc, "updatedAt": now_iso()},
            "scope": "global",
        })

    if g.get("noteType"):
        actions.append({
            "type": "SET_NOTE_TYPE",
            "input": {"noteType": g["noteType"], "updatedAt": now_iso()},
            "scope": "global",
        })

    if g.get("content"):
        actions.append({
            "type": "SET_CONTENT",
            "input": {"content": g["content"], "updatedAt": now_iso()},
            "scope": "global",
        })

    if actions:
        add_actions(doc_id, actions)

    # Topics
    topic_actions = []
    for topic in g.get("topics", []):
        if topic.get("name"):
            topic_actions.append({
                "type": "ADD_TOPIC",
                "input": {"id": topic["id"], "name": topic["name"]},
                "scope": "global",
            })
    if topic_actions:
        add_actions(doc_id, topic_actions)

    # Links (remapped)
    link_actions = []
    for link in g.get("links", []):
        old_target = link.get("targetDocumentId", "")
        new_target = id_map.get(old_target, old_target)
        link_actions.append({
            "type": "ADD_LINK",
            "input": {
                "id": link["id"],
                "targetDocumentId": new_target,
                "targetTitle": link.get("targetTitle", ""),
                "linkType": link.get("linkType", "RELATES_TO"),
            },
            "scope": "global",
        })
    if link_actions:
        # Batch links in groups of 10 to avoid huge payloads
        for i in range(0, len(link_actions), 10):
            add_actions(doc_id, link_actions[i:i+10])

    # Batch 2: Provenance (separate to avoid killing content batch)
    prov = g.get("provenance")
    if prov and prov.get("sourceOrigin"):
        prov_input = {
            "author": prov.get("author", "knowledge-agent"),
            "sourceOrigin": prov["sourceOrigin"],
            "createdAt": prov.get("createdAt", now_iso()),
        }
        if prov.get("sessionId"):
            prov_input["sessionId"] = prov["sessionId"]
        add_actions(doc_id, [{
            "type": "SET_PROVENANCE",
            "input": prov_input,
            "scope": "global",
        }])

    # Metadata fields
    meta_fields = ["scope", "confidence", "severity", "context", "model",
                   "version", "filePath", "editor", "modelId"]
    meta_actions = []
    for field in meta_fields:
        val = g.get(field)
        if val is not None:
            meta_actions.append({
                "type": "SET_METADATA_FIELD",
                "input": {"field": field, "value": str(val), "updatedAt": now_iso()},
                "scope": "global",
            })
    if meta_actions:
        add_actions(doc_id, meta_actions)


def populate_moc(doc_id: str, state: dict, id_map: dict):
    """Populate a MOC document from its state."""
    g = state.get("global", {})

    # CREATE_MOC
    create_input = {
        "title": g.get("title", ""),
        "description": g.get("description", "")[:200] if g.get("description") else "",
        "orientation": g.get("orientation", ""),
        "tier": g.get("tier", "TOPIC"),
        "createdAt": g.get("createdAt", now_iso()),
    }
    if g.get("parentRef"):
        new_parent = id_map.get(g["parentRef"], g["parentRef"])
        create_input["parentRef"] = new_parent

    add_actions(doc_id, [{
        "type": "CREATE_MOC",
        "input": create_input,
        "scope": "global",
    }])

    # ADD_CORE_IDEA (remapped noteRef)
    for idea in g.get("coreIdeas", []):
        old_ref = idea.get("noteRef", "")
        new_ref = id_map.get(old_ref, old_ref)
        add_actions(doc_id, [{
            "type": "ADD_CORE_IDEA",
            "input": {
                "id": idea["id"],
                "noteRef": new_ref,
                "contextPhrase": idea.get("contextPhrase", ""),
                "sortOrder": idea.get("sortOrder", 0),
                "addedAt": idea.get("addedAt", now_iso()),
                "addedBy": idea.get("addedBy"),
            },
            "scope": "global",
        }])

    # ADD_TENSION (remapped involvedRefs)
    for tension in g.get("tensions", []):
        remapped_refs = [id_map.get(r, r) for r in tension.get("involvedRefs", [])]
        add_actions(doc_id, [{
            "type": "ADD_TENSION",
            "input": {
                "id": tension["id"],
                "description": tension.get("description", ""),
                "involvedRefs": remapped_refs,
                "addedAt": tension.get("addedAt", now_iso()),
            },
            "scope": "global",
        }])

    # ADD_OPEN_QUESTION
    for q in g.get("openQuestions", []):
        if isinstance(q, str):
            add_actions(doc_id, [{
                "type": "ADD_OPEN_QUESTION",
                "input": {"question": q},
                "scope": "global",
            }])
        elif isinstance(q, dict) and q.get("question"):
            add_actions(doc_id, [{
                "type": "ADD_OPEN_QUESTION",
                "input": {"question": q["question"]},
                "scope": "global",
            }])

    # ADD_CHILD_MOC (remapped)
    for child_ref in g.get("childRefs", []):
        new_ref = id_map.get(child_ref, child_ref)
        add_actions(doc_id, [{
            "type": "ADD_CHILD_MOC",
            "input": {"childRef": new_ref},
            "scope": "global",
        }])


def populate_source(doc_id: str, state: dict, id_map: dict):
    """Populate a source document from its state."""
    g = state.get("global", {})

    # INGEST_SOURCE
    ingest_input = {
        "title": g.get("title", ""),
        "content": g.get("content", ""),
        "sourceType": g.get("sourceType", "DOCUMENTATION"),
        "createdAt": g.get("createdAt", now_iso()),
    }
    if g.get("description"):
        ingest_input["description"] = g["description"][:200]
    if g.get("createdBy"):
        ingest_input["createdBy"] = g["createdBy"]
    prov = g.get("provenance", {})
    if prov.get("author"):
        ingest_input["author"] = prov["author"]
    if prov.get("url"):
        ingest_input["url"] = prov["url"]

    add_actions(doc_id, [{
        "type": "INGEST_SOURCE",
        "input": ingest_input,
        "scope": "global",
    }])

    # SET_SOURCE_STATUS
    if g.get("status") and g["status"] != "INBOX":
        add_actions(doc_id, [{
            "type": "SET_SOURCE_STATUS",
            "input": {"status": g["status"]},
            "scope": "global",
        }])

    # ADD_EXTRACTED_CLAIM (remapped)
    for claim in g.get("extractedClaims", []):
        claim_ref = claim if isinstance(claim, str) else claim.get("claimRef", "")
        new_ref = id_map.get(claim_ref, claim_ref)
        if new_ref:
            add_actions(doc_id, [{
                "type": "ADD_EXTRACTED_CLAIM",
                "input": {"claimRef": new_ref},
                "scope": "global",
            }])

    # RECORD_EXTRACTION_STATS
    stats = g.get("extractionStats")
    if stats and stats.get("claimCount"):
        add_actions(doc_id, [{
            "type": "RECORD_EXTRACTION_STATS",
            "input": {
                "claimCount": stats["claimCount"],
                "skippedCount": stats.get("skippedCount", 0),
                "skipRate": stats.get("skipRate", 0),
                "extractedAt": stats.get("extractedAt", now_iso()),
                "extractedBy": stats.get("extractedBy"),
            },
            "scope": "global",
        }])


def populate_singleton(doc_id: str, doc_type: str, state: dict, id_map: dict):
    """Populate singleton documents (pipeline-queue, health-report, vault-config, knowledge-graph).
    These are created fresh — we don't import their operational state."""
    pass  # Singletons start empty in the new vault


# ─── Main Import ───

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/import-vault.py <drive-id> [vault-dir]")
        sys.exit(1)

    drive_id = sys.argv[1]
    vault_dir = sys.argv[2] if len(sys.argv) > 2 else VAULT_DIR

    print(f"=== Importing vault from '{vault_dir}' into drive {drive_id} ===\n")

    # ── Step 1: Parse all .phd files ──
    print("Step 1: Parsing .phd files...")
    docs = []
    for root, dirs, files in os.walk(vault_dir):
        for f in sorted(files):
            if not f.endswith(".phd"):
                continue
            path = os.path.join(root, f)
            rel_folder = os.path.relpath(root, vault_dir)
            parsed = parse_phd(path)
            parsed["folder"] = rel_folder
            docs.append(parsed)

    print(f"  Found {len(docs)} documents\n")

    # ── Step 2: Create folders ──
    print("Step 2: Creating folder structure...")
    folder_ids = {}  # path -> folder_id

    # Ordered folder creation (parents first)
    folder_specs = [
        ("knowledge", None),
        ("knowledge/notes", "knowledge"),
        ("sources", None),
        ("ops", None),
        ("ops/health", "ops"),
        ("ops/queue", "ops"),
        ("self", None),
    ]

    for folder_path, parent_path in folder_specs:
        folder_name = folder_path.split("/")[-1]
        parent_id = folder_ids.get(parent_path) if parent_path else None
        fid = add_drive_folder(drive_id, folder_name, parent_id)
        if fid:
            folder_ids[folder_path] = fid
            print(f"  ✓ Created /{folder_path}/ ({fid})")
        else:
            print(f"  ✗ FAILED to create /{folder_path}/")
        time.sleep(DELAY_MS / 1000)

    print()

    # ── Step 3: Create all documents (building ID map) ──
    print("Step 3: Creating documents...")
    id_map = {}  # old_id -> new_id
    doc_registry = []  # (new_id, doc_type, state, old_id)

    # Sort: singletons first, then sources, then notes, then MOCs
    type_order = {
        "bai/vault-config": 0,
        "bai/knowledge-graph": 1,
        "bai/pipeline-queue": 2,
        "bai/health-report": 3,
        "bai/source": 4,
        "bai/knowledge-note": 5,
        "bai/moc": 6,
    }
    docs.sort(key=lambda d: type_order.get(d["header"]["documentType"], 99))

    created = 0
    failed = 0
    for doc in docs:
        header = doc["header"]
        old_id = header["id"]
        doc_type = header["documentType"]
        name = header.get("name", "Untitled")
        folder = doc["folder"]
        parent_folder = folder_ids.get(folder)

        new_id = create_document(drive_id, doc_type, name, parent_folder)
        if new_id:
            id_map[old_id] = new_id
            doc_registry.append((new_id, doc_type, doc["state"], old_id))
            created += 1
            if created % 25 == 0:
                print(f"  ... created {created}/{len(docs)}")
        else:
            failed += 1
            print(f"  ✗ FAILED: {name} ({doc_type})")

        time.sleep(DELAY_MS / 1000)

    print(f"  ✓ Created {created} documents ({failed} failed)")
    print(f"  ID map: {len(id_map)} entries\n")

    # Save ID map for debugging
    with open("/tmp/vault-import-id-map.json", "w") as f:
        json.dump(id_map, f, indent=2)
    print("  Saved ID map to /tmp/vault-import-id-map.json\n")

    # ── Step 4: Populate documents ──
    print("Step 4: Populating document state...")
    populated = 0
    for new_id, doc_type, state, old_id in doc_registry:
        try:
            if doc_type == "bai/knowledge-note":
                populate_knowledge_note(new_id, state, id_map)
            elif doc_type == "bai/moc":
                populate_moc(new_id, state, id_map)
            elif doc_type == "bai/source":
                populate_source(new_id, state, id_map)
            else:
                populate_singleton(new_id, doc_type, state, id_map)

            populated += 1
            if populated % 25 == 0:
                print(f"  ... populated {populated}/{len(doc_registry)}")
        except Exception as e:
            print(f"  ✗ Error populating {new_id} ({doc_type}): {e}")

    print(f"  ✓ Populated {populated} documents\n")

    # ── Step 5: Summary ──
    total_links = 0
    remapped_links = 0
    for _, doc_type, state, _ in doc_registry:
        if doc_type == "bai/knowledge-note":
            for link in state.get("global", {}).get("links", []):
                total_links += 1
                old_target = link.get("targetDocumentId", "")
                if old_target in id_map:
                    remapped_links += 1

    total_refs = 0
    remapped_refs = 0
    for _, doc_type, state, _ in doc_registry:
        if doc_type == "bai/moc":
            for idea in state.get("global", {}).get("coreIdeas", []):
                total_refs += 1
                if idea.get("noteRef", "") in id_map:
                    remapped_refs += 1

    print("=" * 50)
    print("=== IMPORT COMPLETE ===")
    print(f"Documents created:  {created}")
    print(f"Documents failed:   {failed}")
    print(f"Links remapped:     {remapped_links}/{total_links}")
    print(f"MOC refs remapped:  {remapped_refs}/{total_refs}")
    print(f"Broken targets:     {total_links - remapped_links} (pointed outside vault)")
    print(f"ID map saved to:    /tmp/vault-import-id-map.json")
    print("=" * 50)


if __name__ == "__main__":
    main()
