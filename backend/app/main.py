"""FastAPI entry point: CORS, routers, and a global error handler (no stack traces to clients)."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.errors import ApiError

log = logging.getLogger("gridtwin")

app = FastAPI(title="GRIDTWIN — Renewable Distribution Grid Digital Twin", version="1.0.0")
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
