import pytest
from scraper.config import Config, load_config

def test_load_config_reads_required_env(monkeypatch):
    monkeypatch.setattr("scraper.config.load_dotenv", lambda *a, **kw: None)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc_key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    cfg = load_config()
    assert cfg.supabase_url == "https://x.supabase.co"
    assert cfg.supabase_service_role_key == "svc_key"
    assert cfg.anthropic_api_key == "sk-ant-test"

def test_load_config_raises_on_missing(monkeypatch):
    monkeypatch.setattr("scraper.config.load_dotenv", lambda *a, **kw: None)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        load_config()
