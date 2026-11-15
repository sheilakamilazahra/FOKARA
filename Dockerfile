
FROM python:3.13-slim

WORKDIR /app

# Install FFmpeg untuk ekstraksi audio dari video
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install dependency Python
COPY backend/requirements.txt /app/backend/requirements.txt

RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend dan model
COPY backend /app/backend
COPY modeling /app/modeling

WORKDIR /app/backend

ENV PYTHONPATH=/app/backend

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
