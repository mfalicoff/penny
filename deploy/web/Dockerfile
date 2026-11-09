# syntax=docker/dockerfile:1
# Penny web front end (MAZ-63): the Expo web export served by unprivileged nginx,
# which also forwards /api/ to the .NET API so the browser sees one origin.
# Build context: the repository root.
#   docker buildx build --platform linux/amd64,linux/arm64 -f deploy/web/Dockerfile -t penny-web .

ARG NODE_IMAGE=docker.io/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ARG NGINX_IMAGE=docker.io/nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:adf5042a17f4ecdd200c595fa9ffd1be37efb18f89a830bd1a00e4ab4d59d42c

# Static assets are architecture independent: build them once, natively.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Empty: the browser calls /api/ on the origin that served the page. No secret or
# server URL is compiled into the bundle.
ENV EXPO_PUBLIC_API_URL=""
RUN npm run build:web

FROM ${NGINX_IMAGE}
ARG PENNY_VERSION=0.0.0-local
ARG PENNY_REVISION=unknown
LABEL org.opencontainers.image.title="penny-web" \
      org.opencontainers.image.description="Penny web app and same-origin /api proxy" \
      org.opencontainers.image.source="https://github.com/mfalicoff/penny" \
      org.opencontainers.image.version="${PENNY_VERSION}" \
      org.opencontainers.image.revision="${PENNY_REVISION}"
# Rendered by the image's entrypoint (envsubst) into /etc/nginx/conf.d at start.
ENV PENNY_API_UPSTREAM=api:8080 \
    PENNY_MAX_BODY=21m \
    PENNY_REAL_IP_FROM=127.0.0.1/32 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER=^(PENNY_|NGINX_LOCAL_RESOLVERS)
COPY deploy/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
