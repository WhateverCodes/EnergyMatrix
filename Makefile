PY := backend/.venv/bin/python
PORT ?= 8000
PYTHON311 := $(shell command -v python3.11 || command -v python3.12 || command -v python3.10)

.PHONY: setup backend frontend dev test test-backend test-frontend calibrate demo-check

setup:
	test -d backend/.venv || $(PYTHON311) -m venv backend/.venv
	backend/.venv/bin/pip install -q --upgrade pip
	backend/.venv/bin/pip install -q -r backend/requirements.txt
	cd frontend && npm install

backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port $(PORT)

frontend:
	cd frontend && GRIDTWIN_API=http://localhost:$(PORT) npm run dev

dev:
	PORT=$(PORT) ./scripts/dev.sh

test: test-backend test-frontend

test-backend:
	cd backend && .venv/bin/pytest -q

test-frontend:
	cd frontend && npx vitest run

calibrate:
	cd backend && .venv/bin/python ../scripts/calibrate.py

demo-check:
	cd backend && .venv/bin/python ../scripts/demo_check.py
