# Use Node.js 20 Alpine as base image (required by pdfjs-dist)
FROM node:20-alpine

# Install curl for health checks
RUN apk add --no-cache curl

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

# Copy Prisma migrations
COPY prisma/migrations ./prisma/migrations

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start the application (migrations run automatically via start script)
CMD ["npm", "start"]
