# syntax=docker/dockerfile:1

FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    imagemagick \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/rights="none" pattern="PDF"/rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml || true

WORKDIR /app

FROM base AS build
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node prisma ./prisma/
COPY --chown=node:node prisma.config.ts ./
RUN npx prisma generate
COPY --chown=node:node . .
RUN npm run build && install -d -o node -g node /app/uploads

FROM build AS migration
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
COPY --chown=node:node package*.json ./
RUN npm pkg delete devDependencies \
    && npm install --package-lock-only --omit=dev --omit=peer --legacy-peer-deps --ignore-scripts --no-audit \
    && npm ci --omit=dev --omit=peer --legacy-peer-deps --no-audit
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/workflows ./workflows
COPY --from=build --chown=node:node /app/activities ./activities
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN install -d -o node -g node /app/uploads
USER node
EXPOSE 3000
CMD ["npm", "run", "api"]
