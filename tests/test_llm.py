import json
from unittest.mock import patch, MagicMock
from uuid import uuid4
from scraper.llm import LLMScorer
from scraper.models import BestPitch

def test_scorer_parses_claude_cli_output():
    scorer = LLMScorer()
    fake_json = {
        "attack_angles": ["Only 8 reviews → pitch reputation"],
        "review_themes": [],
        "digital_maturity": 3,
        "ai_summary": "Small shop, weak site, clear missed-call angle.",
        "best_pitch": "mcb",
    }
    fake_stdout = json.dumps(fake_json)

    with patch("scraper.llm.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout=fake_stdout, returncode=0)
        lid = uuid4()
        notes = scorer.score(lid, {"review_count": 8, "site_builder": "wix"})

    assert notes.best_pitch == BestPitch.MCB
    assert notes.digital_maturity == 3
    assert notes.lead_id == lid

def test_scorer_strips_code_fences():
    scorer = LLMScorer()
    fake_json = {
        "attack_angles": ["x"],
        "review_themes": [],
        "digital_maturity": 5,
        "ai_summary": "a",
        "best_pitch": "website",
    }
    fake_stdout = "```json\n" + json.dumps(fake_json) + "\n```"

    with patch("scraper.llm.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout=fake_stdout, returncode=0)
        notes = scorer.score(uuid4(), {})

    assert notes.best_pitch == BestPitch.WEBSITE
