# syntax=docker/dockerfile:1.7
#
# Two-stage build for the Astro frontend.
#
# Stage 1 ("build") installs the frontend's Bun deps with the frozen lockfile,
# then runs `astro build` (forced onto Bun's runtime via `bunx --bun`) so the
# pinned Bun version in the parent .bun-version file is what produces dist/.
#
# Stage 2 ("runtime") is nginx:alpine serving the static dist/ on port 80.
# Nginx is used over `astro preview` because it boots faster, has zero Bun
# runtime overhead, and is the conventional way to serve an Astro static
# build in production.
#
# Build context is `./web` (set by docker-compose.yml). The root .bun-version
# is not visible from this context — the bun image tag below pins the runtime.

# ----- Stage 1: build -----
FROM oven/bun:1.3.13-alpine AS build
WORKDIR /web

# Copy lockfile first so the install layer is cached separately from source.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the frontend sources and produce dist/.
COPY . .
RUN bunx --bun astro build

# ----- Stage 2: runtime (nginx alpine) -----
FROM nginx:1.27-alpine AS runner

# Replace the default nginx site config with our minimal one.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built static site.
COPY --from=build /web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=2s --retries=3 \
  CMD wget -qO- "http://127.0.0.1/" >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
