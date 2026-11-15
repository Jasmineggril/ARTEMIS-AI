# ARTEMIS AI — risk engine (FastAPI). Internal service, never exposed publicly.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RISK_ENGINE_MODE=rules
WORKDIR /srv
COPY python_service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 engine
COPY --chown=engine python_service/ ./
USER engine
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
