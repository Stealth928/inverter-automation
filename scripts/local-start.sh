#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TMPDIR="$ROOT_DIR/tmp_docker_check"
mkdir -p "$TMPDIR"

echo "== Docker check: ensure Docker Desktop is running =="
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker CLI not found. Please install Docker Desktop and ensure 'docker' is on PATH." >&2
  exit 2
fi

echo "Building and starting containers (detached, will rebuild)..."
docker compose up -d --build 2>&1 | tee "$TMPDIR/docker_compose_build.log"

sleep 2

echo "== docker compose ps =="
docker compose ps --all | tee "$TMPDIR/docker_compose_ps.txt"

echo "Saving last 200 lines of each service log to $TMPDIR"
SERVICES=$(docker compose ps --services)
for s in $SERVICES; do
  echo "--- logs for service: $s ---" > "$TMPDIR/${s}_logs.txt"
  docker compose logs --no-color --tail 200 $s >> "$TMPDIR/${s}_logs.txt" || true
done

# Wait a few seconds for services to settle
sleep 3

# Curl checks
echo "== Curl checks ==" | tee "$TMPDIR/curl_checks.txt"
# Frontend (Nginx)
if command -v curl >/dev/null 2>&1; then
  echo "-- HEAD http://localhost:8080 --" | tee -a "$TMPDIR/curl_checks.txt"
  curl -I --max-time 5 http://localhost:8080 2>&1 | tee -a "$TMPDIR/curl_checks.txt" || true

  echo "-- GET http://localhost:8080/test.html --" | tee -a "$TMPDIR/curl_checks.txt"
  curl -sS --max-time 5 http://localhost:8080/test.html | head -n 20 >> "$TMPDIR/curl_checks.txt" || true

  echo "-- GET http://localhost:3000/api/config --" | tee -a "$TMPDIR/curl_checks.txt"
  curl -sS --max-time 8 http://localhost:3000/api/config | head -n 200 >> "$TMPDIR/curl_checks.txt" || true

  echo "-- GET http://localhost:3000/health --" | tee -a "$TMPDIR/curl_checks.txt"
  curl -sS --max-time 5 http://localhost:3000/health | tee -a "$TMPDIR/curl_checks.txt" || true
else
  echo "curl not found; skipping HTTP checks (install curl to enable)." | tee -a "$TMPDIR/curl_checks.txt"
fi

# Summary
echo "Diagnostics written to: $TMPDIR"
ls -l "$TMPDIR"

echo "If something failed, please paste the files:"
echo "  $TMPDIR/docker_compose_build.log"
echo "  $TMPDIR/docker_compose_ps.txt"
echo "  $TMPDIR/*_logs.txt"
echo "  $TMPDIR/curl_checks.txt"

exit 0
