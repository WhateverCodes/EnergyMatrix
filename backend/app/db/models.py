"""SQLite persistence (SQLAlchemy 2). Raw time series stay as files; the DB holds metadata and results."""
from __future__ import annotations

import datetime as dt
import os
from functools import lru_cache

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import DB_PATH


class Base(DeclarativeBase):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now()


class DatasetRow(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    source_type: Mapped[str] = mapped_column(String(20))
    is_real: Mapped[bool] = mapped_column(Boolean)
    source: Mapped[str] = mapped_column(Text)
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    coverage_start: Mapped[str | None] = mapped_column(String(40), nullable=True)
    coverage_end: Mapped[str | None] = mapped_column(String(40), nullable=True)
    resolution_min: Mapped[int] = mapped_column(Integer, default=15)
    variables: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class ScenarioRow(Base):
    __tablename__ = "scenarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    config_key: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(200))
    config: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class SimulationRunRow(Base):
    __tablename__ = "simulation_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    config_key: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(40))
    metrics: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class ActionEvaluationRow(Base):
    __tablename__ = "action_evaluations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    evaluation_id: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(60))
    recommended: Mapped[str | None] = mapped_column(String(40), nullable=True)
    candidates: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


class SavedScenarioRow(Base):
    __tablename__ = "saved_scenarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    labels: Mapped[dict] = mapped_column(JSON)
    config: Mapped[dict] = mapped_column(JSON)
    baseline_result: Mapped[dict] = mapped_column(JSON)
    selected_intervention: Mapped[str | None] = mapped_column(String(40), nullable=True)
    final_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    feasibility: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)


def db_url() -> str:
    return f"sqlite:///{os.environ.get('GRIDTWIN_DB', str(DB_PATH))}"


@lru_cache(maxsize=4)
def _engine(url: str):
    eng = create_engine(url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(eng)
    return eng


def session():
    return sessionmaker(bind=_engine(db_url()), expire_on_commit=False)()


def init_db() -> None:
    _engine(db_url())
