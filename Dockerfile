# Graph Lens Lite: viewer + ingest service in one image (Docker or Podman).
#   docker build -t graph-lens-lite .
#   docker run --rm -p 8080:8080 graph-lens-lite      -> http://localhost:8080/
# See SERVICE.md "Running in a container" for the token and other settings.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the Electron binary download; esbuild resolves its
# platform binary through optionalDependencies without the postinstall.
RUN npm ci --ignore-scripts
COPY src ./src
COPY templates ./templates
# The same steps as the release build: vendor libs, prod bundle, single-file HTML.
RUN npm run dist:prep && mv dist/graph-lens-lite_inline_*.html dist/graph_lens_lite.html

FROM node:22-alpine
WORKDIR /app
# server/index.js reads the version from ../package.json; no node_modules are
# needed because the service uses only node builtins.
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist/graph_lens_lite.html ./web/graph_lens_lite.html
# Binding all interfaces is required inside a container; the published port
# decides what is reachable. GLL_API_TOKEN is deliberately not set here.
ENV NODE_ENV=production \
    GLL_API_HOST=0.0.0.0 \
    GLL_API_PORT=8080 \
    GLL_STATIC_DIR=/app/web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- "http://127.0.0.1:${GLL_API_PORT}/health" >/dev/null || exit 1
CMD ["node", "server/index.js"]
