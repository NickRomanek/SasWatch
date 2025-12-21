#!/bin/sh
# Startup script that runs migrations before starting the server

set -e  # Exit on error

echo "[Startup] Step 1: Checking session secret..."
node check-session-secret.js

echo "[Startup] Step 2: Running Prisma migrations..."
npx prisma migrate deploy || {
    echo "[Startup] Error: Migration failed, but continuing to start server..."
    echo "[Startup] You may need to run migrations manually"
}

echo "[Startup] Step 3: Starting server..."
node server.js

