"""Rule-based natural-language What-If parser (works with no API key).

Turns phrases like "increase solar by 30% and take the battery offline" into typed parameter
edits. It never produces electrical values: edits change model INPUTS, and the twin computes results.

Supported: solar ±%, demand ±%, battery unavailable / SOC, line out of service, switch open/close,
cloud event at a time, move consumer to bus / change consumer type / consumer scale,
curtailment cap, voltage limit.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel

from app.load_profiles.profiles import PROFILES
from app.schemas.scenario import CloudEvent, ScenarioConfig
from app.simulation.network_factory import SWITCHABLE_NAMES, get_template

Param = Literal["pv_pct", "demand_pct", "battery_enabled", "battery_soc_pct", "line_out", "switch", "cloud_event",
                "target_bus", "consumer_profile", "consumer_scale", "curtailment_cap_pct", "v_max"]


class Edit(BaseModel):
    param: Param
    value: Any
    label: str
    source: str = ""


class ParseResult(BaseModel):
    edits: list[Edit]
    unparsed: list[str]
    parser: str = "rules"
    notes: list[str] = []


SOLAR = r"(?:solar|pv|photovoltaic|generation|sun(?:shine)?|renewables?|rooftop)"
DEMAND = r"(?:demand|load|consumption|usage)"
UP = r"(?:increase[sd]?|raise[sd]?|boost(?:ed)?|up|more|higher|rises?|grows?|surges?|jumps?|goes up|spikes?|\+)"
DOWN = r"(?:decrease[sd]?|reduce[sd]?|lower(?:ed)?|down|less|drops?|falls?|cut|minus|dips?|goes down|-)"
NUM = r"(\d+(?:\.\d+)?)"
MULT_WORDS = {"double": 2.0, "doubles": 2.0, "doubled": 2.0, "twice": 2.0, "triple": 3.0, "tripled": 3.0,
              "half": 0.5, "halve": 0.5, "halved": 0.5, "halves": 0.5}
PROFILE_ALIASES = {
    "bungalow": "bungalow", "house": "bungalow", "home": "bungalow",
    "residential society": "residential_society", "society": "residential_society", "apartment": "residential_society",
    "neighborhood": "neighborhood", "neighbourhood": "neighborhood",
    "small factory": "small_factory", "factory": "small_factory", "industrial": "small_factory",
    "school": "school", "hospital": "hospital",
    "commercial building": "commercial_building", "commercial": "commercial_building", "mall": "commercial_building",
    "office": "office",
}


def _time(s: str) -> str | None:
    """'12:30', '1 pm', '1:15pm', '13h' -> 'HH:MM' rounded down to 15 min."""
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b", s)
    if not m:
        return None
    h, mm, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").replace(".", "")
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    if not (0 <= h <= 23 and 0 <= mm <= 59):
        return None
    return f"{h:02d}:{(mm // 15) * 15:02d}"


def _clauses(text: str) -> list[str]:
    t = text.lower().replace("%", " % ").replace("percent", " % ")
    parts = re.split(r"[;,]|(?<!\d)\.|\.(?!\d)|\band\b|\bthen\b|\bwhile\b|\bplus\b(?!\s*\d)", t)
    return [p.strip() for p in parts if p and p.strip()]


def _pct_change(c: str, subject: str) -> float | None:
    """Return new level as % of current (e.g. +30 % -> 130)."""
    if not re.search(subject, c):
        return None
    for w, f in MULT_WORDS.items():
        if re.search(rf"\b{w}\b", c):
            return 100.0 * f
    m = re.search(rf"{NUM}\s*(?:%|x\b|times)", c)
    if m is None:
        m = re.search(rf"by\s+{NUM}", c)
    if m is None:
        return None
    v = float(m.group(1))
    if re.search(rf"{NUM}\s*(?:x\b|times)", c):
        return 100.0 * v
    if re.search(rf"\bto\s+{NUM}\s*%", c) and not re.search(r"\bby\b", c):
        return v  # "set solar to 80%"
    if re.search(rf"(?:{DOWN})", c):
        return max(0.0, 100.0 - v)
    if re.search(rf"(?:{UP})", c):
        return 100.0 + v
    return None


def _line_lookup() -> dict[str, int]:
    net = get_template()
    out = {}
    for i, name in net.line["name"].items():
        a, b = name.replace("Line ", "").split("-")
        out[f"{a}-{b}"] = int(i)
        out[f"{b}-{a}"] = int(i)
    return out


def parse(text: str) -> ParseResult:
    edits: list[Edit] = []
    unparsed: list[str] = []
    lines = _line_lookup()
    for c in _clauses(text):
        before = len(edits)
        # --- battery
        if re.search(r"\bbatter(?:y|ies)|bess|storage\b", c):
            if re.search(r"offline|unavailable|out of service|disabled?|no\b|not available|fail(?:s|ed|ure)?|down|remove|without", c):
                edits.append(Edit(param="battery_enabled", value=False, label="Battery unavailable", source=c))
            elif re.search(r"online|available|enable|back", c) and not re.search(r"soc|charge", c):
                edits.append(Edit(param="battery_enabled", value=True, label="Battery available", source=c))
            m = re.search(rf"(?:soc|charged?|state of charge)\D*?{NUM}\s*%", c) or re.search(rf"{NUM}\s*%\s*(?:soc|charged?|full)", c)
            if m:
                edits.append(Edit(param="battery_soc_pct", value=float(m.group(1)), label=f"Battery SOC {float(m.group(1)):.0f}%", source=c))
            elif re.search(r"\bfull(?:y charged)?\b", c):
                edits.append(Edit(param="battery_soc_pct", value=90.0, label="Battery full (90% SOC)", source=c))
            elif re.search(r"\bempty|depleted|flat\b", c):
                edits.append(Edit(param="battery_soc_pct", value=10.0, label="Battery depleted (10% SOC)", source=c))
        # --- curtailment cap
        m = re.search(rf"curtail\w*\s*(?:cap|limit|max(?:imum)?)?\D*?{NUM}\s*%", c) or re.search(rf"(?:cap|limit)\s+curtail\w*\D*?{NUM}", c)
        if m and re.search(r"curtail", c):
            edits.append(Edit(param="curtailment_cap_pct", value=float(m.group(1)), label=f"Curtailment cap {float(m.group(1)):.0f}%", source=c))
        # --- voltage limit
        m = re.search(rf"(?:v\s*max|voltage (?:limit|max(?:imum)?|upper limit))\D*?(1\.\d+)", c)
        if m:
            edits.append(Edit(param="v_max", value=float(m.group(1)), label=f"V max {m.group(1)} pu", source=c))
        # --- cloud event
        if re.search(r"cloud|overcast|shad(?:e|ow)", c):
            t = _time(re.sub(rf"{NUM}\s*(?:min|minutes|%)", "", c)) or "12:00"
            dm = re.search(rf"{NUM}\s*(?:min|minutes)", c)
            hm = re.search(rf"{NUM}\s*(?:h|hr|hours?)\b", c)
            dur = int(float(dm.group(1))) if dm else (int(float(hm.group(1)) * 60) if hm else 60)
            depth_m = re.search(rf"{NUM}\s*%", c)
            depth = min(1.0, float(depth_m.group(1)) / 100.0) if depth_m else 0.7
            dur = max(15, (dur // 15) * 15)
            edits.append(Edit(param="cloud_event", value=CloudEvent(start=t, duration_min=dur, depth=depth).model_dump(),
                              label=f"Cloud at {t} for {dur} min (−{depth * 100:.0f}% PV)", source=c))
        else:
            # --- solar / demand percentage changes (not inside a cloud clause)
            v = _pct_change(c, SOLAR)
            if v is not None and not re.search(r"curtail", c):
                edits.append(Edit(param="pv_pct", value=v, label=f"Solar {v - 100:+.0f}%", source=c))
            v = _pct_change(c, DEMAND)
            if v is not None:
                edits.append(Edit(param="demand_pct", value=v, label=f"Demand {v - 100:+.0f}%", source=c))
        # --- line out of service
        m = re.search(r"line\s*(\d{1,2})\s*[-–to ]+\s*(\d{1,2})", c)
        if m and re.search(r"out|outage|trip|fault|remove|disconnect|fails?|down|lost", c):
            key = f"{m.group(1)}-{m.group(2)}"
            if key in lines:
                edits.append(Edit(param="line_out", value=lines[key], label=f"Line {key} out of service", source=c))
        # --- switches
        m = re.search(r"\b(open|close)\w*\s+(?:switch\s+|tie\s+)?((?:sw\s*)?[\w-]+)", c) or re.search(r"switch\s+([\w-]+)\s+(open|closed?)", c)
        if m:
            a, b = m.group(1), m.group(2)
            action, name = (a, b) if a in ("open", "close", "opened", "closed") or a.startswith(("open", "clos")) else (b, a)
            cand = name.upper().replace("SW", "SW ").replace("  ", " ").strip()
            match = next((s for s in SWITCHABLE_NAMES if s.upper() == cand or s.upper().replace(" ", "") == cand.replace(" ", "")), None)
            if match:
                closed = action.startswith("clos")
                edits.append(Edit(param="switch", value={"name": match, "closed": closed},
                                  label=f"{'Close' if closed else 'Open'} {match}", source=c))
        # --- consumer: move / type / scale
        m = re.search(r"(?:move|put|place|connect|relocate)\b.*?\bbus\s*(\d{1,2})", c) or re.search(r"\bat bus\s*(\d{1,2})", c)
        if m and 1 <= int(m.group(1)) <= 14:
            edits.append(Edit(param="target_bus", value=int(m.group(1)), label=f"Consumer at bus {m.group(1)}", source=c))
        for alias in sorted(PROFILE_ALIASES, key=len, reverse=True):
            if re.search(rf"\b{alias}\b", c):
                key = PROFILE_ALIASES[alias]
                edits.append(Edit(param="consumer_profile", value=key, label=f"Consumer: {PROFILES[key].name}", source=c))
                m2 = re.search(rf"{NUM}\s*x\b|\b(double|triple|half)\b", c)
                if m2:
                    sc = float(m2.group(1)) if m2.group(1) else MULT_WORDS.get(m2.group(2), 1.0)
                    edits.append(Edit(param="consumer_scale", value=sc, label=f"Consumer scale {sc:g}×", source=c))
                break
        if len(edits) == before:
            unparsed.append(c)
    # de-duplicate by param (last wins, except multiple line outages)
    seen: dict[str, Edit] = {}
    multi: list[Edit] = []
    for e in edits:
        if e.param == "line_out":
            multi.append(e)
        else:
            seen[e.param if e.param != "switch" else f"switch:{e.value['name']}"] = e
    return ParseResult(edits=list(seen.values()) + multi, unparsed=unparsed)


def apply_edits(cfg: ScenarioConfig, edits: list[Edit]) -> ScenarioConfig:
    c = cfg.model_copy(deep=True)
    for e in edits:
        v = e.value
        if e.param == "pv_pct":
            c.pv_scale = c.pv_scale * float(v) / 100.0
        elif e.param == "demand_pct":
            c.demand_scale = c.demand_scale * float(v) / 100.0
        elif e.param == "battery_enabled":
            c.battery.enabled = bool(v)
        elif e.param == "battery_soc_pct":
            c.battery.soc_init_pct = min(c.battery.soc_max_pct, max(c.battery.soc_min_pct, float(v)))
        elif e.param == "line_out":
            if int(v) not in c.lines_out_of_service:
                c.lines_out_of_service = [*c.lines_out_of_service, int(v)]
        elif e.param == "switch":
            c.switch_states = {**(c.switch_states or {}), v["name"]: bool(v["closed"])}
        elif e.param == "cloud_event":
            c.cloud_event = CloudEvent.model_validate(v)
        elif e.param == "target_bus":
            c.target_bus = int(v)
        elif e.param == "consumer_profile":
            c.consumer_profile = str(v)
        elif e.param == "consumer_scale":
            c.consumer_scale = float(v)
        elif e.param == "curtailment_cap_pct":
            c.constraints.max_curtailment_pct = float(v)
        elif e.param == "v_max":
            c.constraints.v_max = float(v)
    c.name = f"{cfg.name} + what-if"
    return c
