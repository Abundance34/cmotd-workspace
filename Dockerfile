FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PROCUREFLOW_DATA_DIR=/app/data \
    PROCUREFLOW_DATABASE_BACKEND=postgresql

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p \
    /app/data/attachments \
    /app/data/uploads \
    /app/data/backups

EXPOSE 8080

HEALTHCHECK \
    --interval=30s \
    --timeout=10s \
    --start-period=40s \
    --retries=3 \
    CMD python scripts/database_healthcheck.py \
    && python -c "import os, urllib.request; port=os.environ.get('PORT', '8501'); urllib.request.urlopen(f'http://127.0.0.1:{port}/_stcore/health', timeout=5)" \
    || exit 1

CMD ["sh", "-c", "exec streamlit run app.py --server.address=0.0.0.0 --server.port=${PORT:-8501} --server.headless=true --server.enableXsrfProtection=true --browser.gatherUsageStats=false"]