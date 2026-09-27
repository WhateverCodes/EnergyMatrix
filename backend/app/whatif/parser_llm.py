"""Optional LLM What-If parser. Produces the SAME typed edits as the rule parser (schema-validated);
any invalid or refused output falls back to the rule parser. It only maps words to input parameters —
electrical results always come from the twin."""
from __future__ import annotations

import json
import logging

from pydantic import ValidationError

from app.explain.llm import MODEL, client, llm_available
from app.whatif.parser_rules import Edit, ParseResult, parse

log = logging.getLogger("gridtwin.llm")

SCHEMA = {
    "type": "object",
    "properties": {
        "edits": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "param": {"type": "string", "enum": ["pv_pct", "demand_pct", "battery_enabled", "battery_soc_pct", "line_out",
                                                     "switch", "cloud_event", "target_bus", "consumer_profile", "consumer_scale",
                                                     "curtailment_cap_pct", "v_max"]},
                "value_json": {"type": "string", "description": "JSON-encoded value"},
                "label": {"type": "string"},
            },
            "required": ["param", "value_json", "label"], "additionalProperties": False}},
        "unparsed": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["edits", "unparsed"], "additionalProperties": False,
}

GUIDE = """Map the operator's request to parameter edits for a distribution-grid digital twin.
Values (JSON-encoded in value_json):
- pv_pct / demand_pct: new level as % of current (e.g. "+30%" -> 130, "halve" -> 50)
- battery_enabled: true/false; battery_soc_pct: 10..90
- line_out: integer line index. Lines: {lines}
- switch: {{"name": one of {switches}, "closed": true/false}}
- cloud_event: {{"start": "HH:MM" (15-min), "duration_min": >=15, "depth": 0..1}}
- target_bus: 1..14; consumer_profile: one of {profiles}; consumer_scale: number
- curtailment_cap_pct: 0..100; v_max: pu, e.g. 1.06
Put any part you cannot map into "unparsed". Never invent values the request does not state."""


def parse_llm(text: str) -> ParseResult:
    if not llm_available():
        return parse(text)
    import anthropic

    from app.load_profiles.profiles import PROFILES
    from app.simulation.network_factory import SWITCHABLE_NAMES, get_template
    lines = ", ".join(f"{i}={n}" for i, n in get_template().line["name"].items())
    guide = GUIDE.format(lines=lines, switches=SWITCHABLE_NAMES, profiles=sorted(PROFILES))
    try:
        resp = client().beta.messages.create(
            model=MODEL, max_tokens=4000, system=guide,
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": text}],
        )
        if resp.stop_reason == "refusal":
            raise ValueError("refusal")
        data = json.loads("".join(b.text for b in resp.content if b.type == "text"))
        edits = [Edit(param=e["param"], value=json.loads(e["value_json"]), label=e["label"], source=text) for e in data["edits"]]
        from app.whatif.parser_rules import apply_edits
        from app.schemas.scenario import ScenarioConfig
        apply_edits(ScenarioConfig(), edits)  # validates every value against the model schema
        return ParseResult(edits=edits, unparsed=data["unparsed"], parser="llm")
    except (anthropic.APIStatusError, anthropic.APIConnectionError, ValueError, KeyError, ValidationError, TypeError) as exc:
        log.warning("LLM parse failed (%s); using rule parser", type(exc).__name__)
        r = parse(text)
        r.notes.append("LLM parser unavailable or invalid output — rule parser used")
        return r
