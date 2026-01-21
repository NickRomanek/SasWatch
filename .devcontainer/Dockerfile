FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bullseye

# Install PostgreSQL client tools (for debugging)
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends postgresql-client \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install Playwright browsers for E2E testing
RUN npx playwright install --with-deps chromium

# Set working directory
WORKDIR /workspace

# Default command (overridden by devcontainer.json)
CMD ["sleep", "infinity"]
