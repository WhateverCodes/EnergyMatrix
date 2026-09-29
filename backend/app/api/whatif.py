"""What-If Lab: natural language -> editable parameter chips -> twin -> result + explanation."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.serialize import clean
from app.explain.llm import llm_available, rephrase
from app.optimization.evaluator import cached_entry, config_key, evaluate
from app.schemas.scenario import ScenarioConfig
from app.simulation.metrics import compute_metrics
from app.whatif.parser_llm import parse_llm
from app.whatif.parser_rules import Edit, apply_edits, parse

router = APIRouter(prefix="/api/whatif")


class ParseRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    use_llm: bool = False


class RunRequest(BaseModel):
    config: ScenarioConfig
    edits: list[Edit]
    rephrase: bool = False


@router.post("/parse")
def whatif_parse(req: ParseRequest) -> dict:
    r = parse_llm(req.text) if req.use_llm else parse(req.text)
    return clean(r.model_dump() | {"llm_available": llm_available()})


@router.post("/run")
def whatif_run(req: RunRequest) -> dict:
    cfg = apply_edits(req.config, req.edits)
    ev = evaluate(cfg)
    entry = cached_entry(config_key(cfg))
    base = entry["results"]["none"]
    explanation = {"text": ev["explanation"], "source": "template"}
    if req.rephrase:
        explanation = rephrase(ev["explanation"])
    rec = next((c for c in ev["candidates"] if c["recommended"]), None)
    return clean({
        "config": cfg.model_dump(), "edits": [e.model_dump() for e in req.edits],
        "baseline": {"status": base.summary["status"], "metrics": compute_metrics(base), "violations": base.summary["violations"]},
        "evaluation_status": ev["status"], "recommended": rec, "explanation": explanation,
        "infeasibility": ev["infeasibility"], "honesty": entry["inputs"].honesty,
        "candidates": [{k: c.get(k) for k in ("key", "name", "feasible", "available", "J", "rank")} for c in ev["candidates"]],
    })
