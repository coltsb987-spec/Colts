"""Ask Claude WHY a trader likely made a move, from the evidence we gathered. Honest about confidence.

Claude only sees facts we collected (price action, BTC, funding/OI, the trader's history, any post
text). It is told there is no news feed and that it must say "unclear" rather than guess.
Output is forced into a JSON schema so alerts always have a reason + confidence label.
"""

from __future__ import annotations

import json
import logging
import os
import time

log = logging.getLogger("analyst.reasoner")

SYSTEM = """You are a careful trading analyst. A trader on the Invo copy-trading app just made a move.
You get ONLY the evidence below. Infer the most likely reason for the move, for a beginner reader.

Rules:
- Use only the evidence given. Never invent news, events, posts, indicators or numbers.
- No news feed is connected. Do not attribute a trade to news unless the trader's own post says so.
- Confidence: "high" only when several independent pieces of evidence point the same way AND the
  trade fits the trader's usual pattern (or their own post states the reason). "medium" when one clear
  technical setup explains it. "low" when the evidence is thin, mixed, or the data was unavailable.
- If you cannot tell, set reason_unclear to true and say plainly that the reason is unclear.
- Say "likely" or "possibly", never "the trader did X because" as fact. You cannot read their mind.
- No advice to copy the trade. No predictions of profit.
- reason: 2 or 3 short sentences, plain English."""

OPEN_SCHEMA = {
    "type": "object",
    "properties": {
        "reason": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "reason_unclear": {"type": "boolean"},
        "evidence_used": {"type": "array", "items": {"type": "string"}},
        "fits_usual_pattern": {"type": "string", "enum": ["yes", "partly", "no", "unknown"]},
    },
    "required": ["reason", "confidence", "reason_unclear", "evidence_used", "fits_usual_pattern"],
    "additionalProperties": False,
}

CLOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "note": {"type": "string"},
        "reasoning_played_out": {"type": "string", "enum": ["yes", "partly", "no", "unclear"]},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": ["note", "reasoning_played_out", "confidence"],
    "additionalProperties": False,
}

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "patterns": {"type": "array", "items": {"type": "string"}},
        "what_seems_to_work": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["patterns", "what_seems_to_work"],
    "additionalProperties": False,
}


class Reasoner:
    def __init__(self, cfg: dict, client=None):
        self.enabled = bool(cfg.get("enabled", True))
        self.model = cfg.get("model", "claude-opus-5-5")
        self.effort = cfg.get("effort", "medium")
        self.max_calls_per_day = int(cfg.get("max_calls_per_day", 200))
        self._day, self._calls = None, 0
        self.client = client
        if self.enabled and self.client is None:
            if not os.environ.get("ANTHROPIC_API_KEY"):
                log.warning("ANTHROPIC_API_KEY not set: explanations disabled")
                self.enabled = False
            else:
                try:
                    import anthropic
                    self.client = anthropic.Anthropic()
                except ImportError:
                    log.warning("anthropic package not installed (pip install -r requirements.txt): explanations disabled")
                    self.enabled = False

    def _budget_ok(self) -> bool:
        day = time.strftime("%Y-%m-%d", time.gmtime())
        if day != self._day:
            self._day, self._calls = day, 0
        if self._calls >= self.max_calls_per_day:
            log.warning("daily Claude call cap (%d) reached; skipping explanation", self.max_calls_per_day)
            return False
        self._calls += 1
        return True

    def _ask(self, user_text: str, schema: dict, max_tokens: int = 4000) -> dict | None:
        if not self.enabled or not self._budget_ok():
            return None
        import anthropic
        try:
            # Server-side fallbacks: if the model declines, the API retries on a fallback model in the same call.
            resp = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=SYSTEM,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                messages=[{"role": "user", "content": user_text}],
            )
        except anthropic.AuthenticationError:
            log.error("Anthropic rejected the API key; explanations disabled until restart")
            self.enabled = False
            return None
        except anthropic.RateLimitError:
            log.warning("Anthropic rate limit; skipping this explanation")
            return None
        except anthropic.APIStatusError as e:
            log.warning("Anthropic API error %s; skipping this explanation", e.status_code)
            return None
        except anthropic.APIConnectionError:
            log.warning("Anthropic unreachable; skipping this explanation")
            return None
        if resp.stop_reason == "refusal":
            log.warning("Claude declined to analyse this event")
            return None
        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            return json.loads(text)
        except ValueError:
            log.warning("Claude returned unparseable output (stop_reason=%s)", resp.stop_reason)
            return None

    def explain_move(self, event: dict, evidence: dict) -> dict:
        prompt = ("THE MOVE:\n" + json.dumps(event, indent=1, default=str) +
                  "\n\nEVIDENCE:\n" + json.dumps(evidence, indent=1, default=str))
        out = self._ask(prompt, OPEN_SCHEMA)
        if out is None:
            return {"reason": "Not analysed (AI explanation unavailable). Raw context is saved in the database.",
                    "confidence": "low", "reason_unclear": True, "evidence_used": [], "fits_usual_pattern": "unknown",
                    "model": "none"}
        out["model"] = self.model
        return out

    def review_close(self, close_event: dict, original: dict | None, price_after: dict) -> dict:
        prompt = ("A trade just CLOSED. Say briefly whether the reasoning given when it opened played out.\n"
                  "Judge the reasoning, not luck: a loss can still follow sound reasoning, and vice versa.\n\n"
                  "CLOSE:\n" + json.dumps(close_event, indent=1, default=str) +
                  "\n\nORIGINAL EXPLANATION (may be missing):\n" + json.dumps(original, indent=1, default=str) +
                  "\n\nPRICE ACTION AT CLOSE:\n" + json.dumps(price_after, indent=1, default=str))
        out = self._ask(prompt, CLOSE_SCHEMA, 2000)
        if out is None:
            return {"note": "Not analysed (AI unavailable).", "reasoning_played_out": "unclear", "confidence": "low",
                    "model": "none"}
        out["model"] = self.model
        return out

    def summarise_day(self, facts: dict) -> dict | None:
        prompt = ("Here are the last 24 hours of moves by the top traders we watch, plus closed-trade results.\n"
                  "List recurring patterns and what seems to be working. These are HYPOTHESES from a small "
                  "sample, so phrase them that way. 3-5 bullets each, max. Do not recommend trades.\n\n"
                  + json.dumps(facts, indent=1, default=str))
        return self._ask(prompt, SUMMARY_SCHEMA, 4000)
