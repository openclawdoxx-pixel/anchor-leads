import json
import subprocess
from pathlib import Path
from uuid import UUID
from scraper.models import LeadNotes, BestPitch

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "score_lead.md"

class LLMScorer:
    def __init__(self) -> None:
        self.system_prompt = PROMPT_PATH.read_text()

    def score(self, lead_id: UUID, enrichment_row: dict) -> LeadNotes:
        user_payload = json.dumps(enrichment_row, default=str)
        full_prompt = f"{self.system_prompt}\n\n---\n\nLead data:\n{user_payload}"
        result = subprocess.run(
            ["claude", "-p", full_prompt],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(f"claude -p failed: {result.stderr}")
        text = result.stdout.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
            text = text.strip("`").strip()
        data = json.loads(text)
        return LeadNotes(
            lead_id=lead_id,
            attack_angles=data["attack_angles"],
            review_themes=data.get("review_themes", []),
            digital_maturity=int(data["digital_maturity"]),
            ai_summary=data["ai_summary"],
            best_pitch=BestPitch(data["best_pitch"]),
        )
