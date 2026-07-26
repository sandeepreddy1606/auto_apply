# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Python backend that also serves the built frontend ---
FROM python:3.12-slim AS app
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
# The backend serves ../frontend/dist — drop the built assets there.
COPY --from=frontend /fe/dist /app/frontend/dist

# Persist settings/login/telegram-session/resumes on a mounted volume.
ENV AUTO_APPLY_DATA_DIR=/data \
    PORT=8787 \
    AUTO_APPLY_HOST=0.0.0.0
VOLUME ["/data"]
EXPOSE 8787
CMD ["python", "run.py"]
