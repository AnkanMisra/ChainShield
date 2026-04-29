# syntax=docker/dockerfile:1.7

# ----- Stage 1: install production dependencies -----
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ----- Stage 2: runtime image -----
FROM oven/bun:1.3-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

# Bring in only what the server needs at runtime
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY public ./public

# Drop privileges
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 8787

# wget ships with busybox in the alpine base image
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["bun", "run", "src/risk-gate/server.ts"]
