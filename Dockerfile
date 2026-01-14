# syntax=docker/dockerfile:1

FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    imagemagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Configure ImageMagick policy to allow PDF processing
RUN sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml || true

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy prisma schema for generation
COPY prisma ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Expose ports
EXPOSE 3000 3001

# Default command (can be overridden in docker-compose)
CMD ["npm", "run", "api"]
