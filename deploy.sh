#!/bin/bash
set -e

APP_DIR="/opt/hours-dashboard"
BRANCH="master"

echo "=== Hours Dashboard Deploy ==="
echo "$(date '+%Y-%m-%d %H:%M:%S')"
echo ""

cd "$APP_DIR"

echo "[1/4] Pulling latest code..."
git pull origin "$BRANCH"

echo ""
echo "[2/4] Building Docker image..."
docker compose up -d --build

echo ""
echo "[3/4] Waiting for service to start..."
sleep 5

echo ""
echo "[4/4] Health check..."
if curl -sf http://localhost:5179/api/healthz > /dev/null 2>&1; then
  echo "OK - service is healthy"
  curl -s http://localhost:5179/api/healthz
  echo ""
else
  echo "WARN - health check failed, checking logs..."
  docker compose logs --tail=20
  exit 1
fi

echo ""
echo "=== Deploy complete ==="
