#!/bin/bash
# Inicia o serviço Python FastAPI na porta 8000
cd "$(dirname "$0")"
uvicorn app:app --host 0.0.0.0 --port 8000
