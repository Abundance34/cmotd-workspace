from pathlib import Path


def test_streamlit_is_forced_to_light_theme():
    config = Path('.streamlit/config.toml').read_text(encoding='utf-8')
    assert 'base = "light"' in config
    assert 'backgroundColor = "#F7F9FC"' in config
    assert 'textColor = "#172033"' in config


def test_browser_dark_theme_probe_is_removed():
    app = Path('app.py').read_text(encoding='utf-8')
    assert 'sync_browser_theme' not in app
    assert 'prefers-color-scheme: dark' not in app
    assert 'data-pf-theme' not in app


def test_final_ui_layer_is_light_only_and_sidebar_safe():
    ui = Path('core/ui.py').read_text(encoding='utf-8')
    assert 'ProcureFlow intentionally uses one authoritative light theme' in ui
    assert 'color-scheme: light !important' in ui
    assert '--pf-live-bg: #f7f9fc' in ui
    assert 'button[kind="primary"]' in ui
    assert 'button[kind="secondary"]' in ui
    assert 'prefers-color-scheme: dark' not in ui
    assert '--pf-bg: #09111f' not in ui
    assert '--pf-live-bg: var(--background-color' not in ui


def test_active_sidebar_button_uses_streamlit_primary_type():
    app = Path('app.py').read_text(encoding='utf-8')
    assert 'type="primary" if section == selected else "secondary"' in app


def test_sidebar_navigation_uses_stable_streamlit_button_selectors():
    ui = Path('core/ui.py').read_text(encoding='utf-8')
    app = Path('app.py').read_text(encoding='utf-8')
    for source in (ui, app):
        assert 'button[data-testid="stBaseButton-secondary"]' in source or "button[data-testid='stBaseButton-secondary']" in source
        assert 'button[data-testid="baseButton-secondary"]' in source or "button[data-testid='baseButton-secondary']" in source
        assert 'background-color: transparent !important' in source
        assert 'button[data-testid="stBaseButton-primary"]' in source or "button[data-testid='stBaseButton-primary']" in source
    assert 'section[data-testid="stSidebar"] .stButton > button' in ui


def test_sidebar_navigation_text_is_never_low_opacity():
    ui = Path('core/ui.py').read_text(encoding='utf-8')
    assert 'section[data-testid="stSidebar"] .stButton > button p' in ui
    assert 'opacity: 1 !important' in ui
