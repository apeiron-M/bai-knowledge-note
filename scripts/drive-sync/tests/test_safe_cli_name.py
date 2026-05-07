"""Tests for upload._safe_cli_name — the CLI argv-safety guard."""
import importlib
import sys
from pathlib import Path

# upload.py is a script, not a module under a package; import it directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
upload = importlib.import_module("upload")
_safe_cli_name = upload._safe_cli_name


FALLBACK = "doc-abcd1234"


def test_normal_name_passes_through():
    assert _safe_cli_name("hello world", FALLBACK) == "hello world"


def test_empty_name_uses_fallback():
    assert _safe_cli_name("", FALLBACK) == FALLBACK


def test_none_name_uses_fallback():
    assert _safe_cli_name(None, FALLBACK) == FALLBACK


def test_leading_hyphen_uses_fallback():
    assert _safe_cli_name("-foo", FALLBACK) == FALLBACK


def test_double_hyphen_uses_fallback():
    assert _safe_cli_name("--name", FALLBACK) == FALLBACK


def test_hyphen_inside_name_is_fine():
    assert _safe_cli_name("foo-bar", FALLBACK) == "foo-bar"


def test_comma_uses_fallback():
    assert _safe_cli_name("Hello, world", FALLBACK) == FALLBACK


def test_double_quote_uses_fallback():
    assert _safe_cli_name('Say "hi"', FALLBACK) == FALLBACK


def test_backslash_uses_fallback():
    assert _safe_cli_name("a\\b", FALLBACK) == FALLBACK


def test_newline_uses_fallback():
    assert _safe_cli_name("foo\nbar", FALLBACK) == FALLBACK


def test_tab_uses_fallback():
    assert _safe_cli_name("foo\tbar", FALLBACK) == FALLBACK


def test_null_byte_uses_fallback():
    assert _safe_cli_name("foo\x00bar", FALLBACK) == FALLBACK


def test_del_byte_uses_fallback():
    assert _safe_cli_name("foo\x7fbar", FALLBACK) == FALLBACK


def test_unicode_letters_pass_through():
    # Multibyte unicode is fine — the CLI receives bytes via argv
    assert _safe_cli_name("café résumé", FALLBACK) == "café résumé"
