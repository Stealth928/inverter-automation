# Docker Development Setup

This document explains how to run the Inverter app locally using Docker and Docker Compose.

## Goals
- Containerize backend, functions (using functions-framework), and frontend (Nginx) for local testing
- Allow easy startup with `docker compose up`
- Provide environment files for local secrets

## Requirements
- Docker Desktop or Docker Engine installed
- Docker Compose v2 (or use Docker Compose CLI)

## Build & Run

```bash
# Build containers and start in background
cd /Users/andreas.marmaras/Downloads/Inverter
docker compose up -d --build

# Check status
docker compose ps

# Stop containers
docker compose down
```

## Accessing Services
- Backend: http://localhost:3000
- Functions endpoints: http://localhost:5001 (functions-framework)
- Frontend: http://localhost:8080

## Notes
- The Nginx config proxies `/api/` to the `functions` service. If you prefer to use the legacy backend for API, change `proxy_pass` in `frontend/nginx.conf` to `http://backend:3000/api/`.
- Provide your FoxESS and Amber API keys in `.env` files (not committed) or set them in the functions `.runtimeconfig.env` and `backend/.env` before starting the containers.
- The `functions` service uses `functions-framework` to expose the `api` export from `functions/index.js`. If you rename the export, update `FUNCTION_TARGET` in the Dockerfile.

## Debugging
- Tail logs for a service: `docker compose logs -f backend` or `docker compose logs -f functions`.
- Verify emulator or external Firebase usage by inspecting `functions/.runtimeconfig.env` and `.env` files.

## Using the Firebase emulators
You can still run the firebase emulators locally for more accurate testing (Firestore, Auth). To connect the functions to the emulators, run `firebase emulators:start` in a separate terminal and configure the `functions` container's runtime to point to the emulator host.

## Troubleshooting
- Permission denied during `npm ci` in containers: ensure the project files are readable by the container user. You can set an explicit user or add a build stage to copy in node_modules.
- Port conflicts: change ports in `docker-compose.yml` if ports 3000, 5001, 8080 are already in use.

