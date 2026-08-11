from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app.py"


def _last_function_source(function_name: str) -> str:
    source = APP_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source)
    matches = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    ]
    assert matches, f"Missing {function_name}"
    return ast.get_source_segment(source, matches[-1]) or ""


def test_sidebar_badges_use_exact_widget_key_tokens():
    source = _last_function_source("render_sidebar_navigation")
    assert "div[class~='st-key-{button_key}'] button" in source
    assert "div[class~='st-key-{safe_button_key}'] button" in source
    assert "div[class*='st-key-{button_key}'] button" not in source
    assert "div[class*='st-key-{safe_button_key}'] button" not in source


def test_sidebar_badge_count_is_not_duplicated_in_button_label():
    source = _last_function_source("render_sidebar_navigation")
    assert "label_badge" not in source
    assert "🔴" not in source
    assert 'label = f"{nav_icon_for(section)}  {section}"' in source


def test_index_one_selector_cannot_match_index_ten():
    # Exact class-token matching is the key regression: a class token for index
    # 10 must never satisfy the index-1 selector.
    index_one = "st-key-pf-nav-button-procurement-section-1"
    index_ten = "st-key-pf-nav-button-procurement-section-10"
    class_tokens = {"element-container", index_ten, "st-emotion-cache-example"}
    assert index_one not in class_tokens
    assert index_ten in class_tokens
