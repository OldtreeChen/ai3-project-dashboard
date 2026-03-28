FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma client (needed for raw SQL via $queryRawUnsafe)
# Use --allow-no-models since we only use raw SQL, no Prisma models
RUN npx prisma generate --allow-no-models 2>/dev/null || true
RUN node ./node_modules/next/dist/bin/next build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5179

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 5179

# Note: DATABASE_URL should be injected via env var or docker-compose .env
CMD ["sh", "-c", "node ./node_modules/next/dist/bin/next start -p ${PORT:-5179}"]







