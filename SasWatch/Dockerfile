# Use Node.js 18 Debian slim as base image (for poppler support)
FROM node:18-bullseye-slim

# Install curl for health checks and poppler-utils for PDF image extraction
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for prisma CLI)
RUN npm ci

# Copy Prisma schema file explicitly to ensure it's available
COPY prisma/schema.prisma ./prisma/schema.prisma

# Generate Prisma client
RUN npx prisma generate

# Copy the rest of the application code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application
CMD ["npm", "start"]
