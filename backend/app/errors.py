from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Error surfaced to clients as {"error_code","message","details"}."""

    def __init__(self, code: str, message: str, status: int = 400, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details if details is not None else {}
