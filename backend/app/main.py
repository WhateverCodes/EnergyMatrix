"""FastAPI entry point: CORS, routers, and a global error handler (no stack traces to clients)."""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import core, simulate
from app.datasets.registry import all_datasets
from app.db.models import init_db
from app.errors import ApiError
from app.optimization.evaluator import warm_pool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("gridtwin")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    all_datasets()  # parse datasets once; prints a clear warning if Kaggle files are missing
    threading.Thread(target=warm_pool, daemon=True).start()
    yield


app = FastAPI(title="GRIDTWIN — Renewable Distribution Grid Digital Twin", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"error_code": exc.code, "message": exc.message, "details": exc.details})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    details = [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"error_code": "VALIDATION_ERROR", "message": "Request failed validation", "details": details})


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception):
    log.exception("unhandled error")
    return JSONResponse(status_code=500, content={"error_code": "INTERNAL_ERROR", "message": "Internal server error", "details": {"type": type(exc).__name__}})


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(core.router)
app.include_router(simulate.router)
