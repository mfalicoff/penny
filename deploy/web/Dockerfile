# syntax=docker/dockerfile:1
# Penny web front end (MAZ-63, MAZ-97): the v2 browser app (apps/web: React, Vite,
# TanStack) served by unprivileged nginx, which also forwards /api/ to the .NET API so
# the browser sees one origin. The Expo web export is no longer part of this image.
# Build context: the repository root (apps/web imports ../../design-kit and ../../src/domain).
#   docker buildx build --platform linux/amd64,linux/arm64 -f deploy/web/Dockerfile -t penny-web .

ARG NODE_IMAGE=docker.io/library/node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
ARG NGINX_IMAGE=docker.io/nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e

# Static assets are architecture independent: build them once, natively.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY design-kit/ /src/design-kit/
COPY src/domain/ /src/src/domain/
COPY apps/web/ ./
# No server URL, secret or connection string is compiled into the bundle: the browser
# calls /api/ on the origin that served the page. `build` also runs scripts/verify-dist.ts.
ENV CI=1
RUN npm run build
# Which build is serving, for upgrade and rollback checks (`curl /version.json`).
ARG PENNY_VERSION=0.0.0-local
ARG PENNY_REVISION=unknown
RUN printf '{"version":"%s","revision":"%s"}\n' "${PENNY_VERSION}" "${PENNY_REVISION}" > dist/version.json

FROM ${NGINX_IMAGE}
ARG PENNY_VERSION=0.0.0-local
ARG PENNY_REVISION=unknown
LABEL org.opencontainers.image.title="penny-web" \
      org.opencontainers.image.description="Penny v2 web app and same-origin /api proxy" \
      org.opencontainers.image.source="https://github.com/mfalicoff/penny" \
      org.opencontainers.image.version="${PENNY_VERSION}" \
      org.opencontainers.image.revision="${PENNY_REVISION}"
# Rendered by the image's entrypoint (envsubst) into /etc/nginx/conf.d at start.
ENV PENNY_API_UPSTREAM=api:8080 \
    PENNY_MAX_BODY=21m \
    PENNY_REAL_IP_FROM=127.0.0.1/32 \
    PENNY_WEB_TELEMETRY_URL= \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER=^(PENNY_|NGINX_LOCAL_RESOLVERS)
COPY deploy/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 deploy/web/15-penny-telemetry-url.sh /docker-entrypoint.d/15-penny-telemetry-url.sh
COPY --from=build /src/apps/web/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
