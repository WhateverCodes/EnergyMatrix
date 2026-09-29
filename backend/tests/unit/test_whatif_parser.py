import pytest

from app.schemas.scenario import ScenarioConfig
from app.whatif.parser_rules import apply_edits, parse


def edits(text):
    return {(e.param, str(e.value)) for e in parse(text).edits}


@pytest.mark.parametrize("text,expected", [
    ("increase solar by 30%", {("pv_pct", "130.0")}),
    ("PV up 50 percent", {("pv_pct", "150.0")}),
    ("reduce generation by 40%", {("pv_pct", "60.0")}),
    ("double the solar", {("pv_pct", "200.0")}),
    ("demand drops 20%", {("demand_pct", "80.0")}),
    ("load rises by 15 %", {("demand_pct", "115.0")}),
    ("battery offline", {("battery_enabled", "False")}),
    ("no battery available", {("battery_enabled", "False")}),
    ("battery is full", {("battery_soc_pct", "90.0")}),
    ("battery at 25% SOC", {("battery_soc_pct", "25.0")}),
    ("take line 3-4 out of service", {("line_out", "2")}),
    ("line 8 to 9 trips", {("line_out", "6")}),
    ("close S1", {("switch", "{'name': 'S1', 'closed': True}")}),
    ("open switch sw 3-8", {("switch", "{'name': 'SW 3-8', 'closed': False}")}),
    ("cap curtailment at 30%", {("curtailment_cap_pct", "30.0")}),
    ("set curtailment limit to 10 %", {("curtailment_cap_pct", "10.0")}),
    ("move the consumer to bus 6", {("target_bus", "6")}),
    ("voltage limit 1.06", {("v_max", "1.06")}),
])
def test_single_phrasings(text, expected):
    assert edits(text) == expected


def test_cloud_event_time_duration_depth():
    r = parse("a cloud passes at 1:15 pm for 45 minutes cutting 60% of PV")
    e = next(x for x in r.edits if x.param == "cloud_event")
    assert e.value == {"start": "13:15", "duration_min": 45, "depth": 0.6}
    # a cloud clause must not be misread as a solar % change
    assert not any(x.param == "pv_pct" for x in r.edits)


def test_compound_sentence():
    r = parse("Increase solar by 30%, take the battery offline and put a hospital at bus 5")
    got = {e.param for e in r.edits}
    assert got == {"pv_pct", "battery_enabled", "target_bus", "consumer_profile"}
    assert r.unparsed == []


def test_unparsed_reported_not_guessed():
    r = parse("make it rain frogs")
    assert r.edits == [] and r.unparsed == ["make it rain frogs"]


def test_apply_edits_changes_only_inputs():
    base = ScenarioConfig(pv_scale=1.0)
    out = apply_edits(base, parse("solar +30% and battery offline and close S1 and line 3-4 out").edits)
    assert out.pv_scale == pytest.approx(1.3)
    assert out.battery.enabled is False
    assert out.switch_states == {"S1": True}
    assert out.lines_out_of_service == [2]
    assert base.battery.enabled is True  # original untouched


def test_llm_number_validation_rejects_invented_numbers(monkeypatch):
    from app.explain.llm import numbers_consistent, rephrase
    src = "Battery was selected: max voltage 1.061 → 1.044 pu, 0 MWh curtailed (J = 2.52)."
    assert numbers_consistent("Using the battery cut peak voltage from 1.061 to 1.044 pu with 0 MWh curtailed; J = 2.52.", src)
    assert not numbers_consistent("The battery reduced voltage by 3% to 1.044 pu.", src)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert rephrase(src) == {"text": src, "source": "template"}  # no key -> template, no network


def test_llm_parser_falls_back_to_rules_without_key(monkeypatch):
    from app.whatif.parser_llm import parse_llm
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    r = parse_llm("increase solar by 30%")
    assert r.parser == "rules" and r.edits[0].param == "pv_pct"
