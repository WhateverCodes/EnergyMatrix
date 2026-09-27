"""Optional LLM rephrasing of deterministic explanations.

Active only if ANTHROPIC_API_KEY is set AND the `anthropic` package is installed (imported lazily).
The LLM never produces electrical values: every number in its output must already appear in the
template text (after normalising formatting), otherwise the template is returned unchanged.
"""
from __future__ import annotations

import logging
import os
import re

log = logging.getLogger("gridtwin.llm")

MODEL = os.environ.get("GRIDTWIN_LLM_MODEL", "claude-opus-5")
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def llm_available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def numbers(text: str) -> set[str]:
    """Numbers as canonical strings ('1.050' -> '1.05', '20' -> '20'); times like 12:15 split into parts."""
    out = set()
    for m in _NUM.findall(text):
        v = float(m)
        out.add(f"{v:g}")
    return out


def numbers_consistent(candidate: str, source: str) -> bool:
    return numbers(candidate) <= numbers(source)


def client():
    import anthropic
    return anthropic.Anthropic()


def call_text(system: str, prompt: str, max_tokens: int = 2000) -> str | None:
    """One Claude call with server-side refusal fallbacks; returns text or None on any failure/refusal."""
    import anthropic
    try:
        resp = client().beta.messages.create(
            model=MODEL, max_tokens=max_tokens, system=system,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": prompt}],
        )
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        log.warning("LLM call failed: %s", exc)
        return None
    if resp.stop_reason == "refusal":
        return None
    return "".join(b.text for b in resp.content if b.type == "text").strip() or None


def rephrase(template: str) -> dict:
    """Return {'text', 'source'}; source is 'llm' only when the rephrase passed number validation."""
    if not llm_available():
        return {"text": template, "source": "template"}
    out = call_text(
        "You rewrite power-system operator explanations for a non-specialist audience. Keep every number exactly "
        "as given, add no new numbers, facts or recommendations. Two to three plain sentences.",
        f"Rewrite this explanation:\n\n{template}", max_tokens=800)
    if out and numbers_consistent(out, template):
        return {"text": out, "source": "llm"}
    return {"text": template, "source": "template", "note": "LLM output rejected: numbers did not match the simulation" if out else None}
