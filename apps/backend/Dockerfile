# syntax=docker/dockerfile:1
# Penny .NET API (MAZ-63). Build context: apps/backend.
#   docker buildx build --platform linux/amd64,linux/arm64 -t penny-api apps/backend
# Every base image is pinned to a multi-platform index digest. The managed output is
# architecture independent, so the SDK and model stages run on the build machine's
# platform and only the runtime stage is per-architecture (no emulated compilation).

ARG SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0.404-noble@sha256:fe0fd4e93bd2fbb47c883b7a6369e5c8d3db8bf01cdc5981f6ee35fbdf3ff4fb
ARG RUNTIME_IMAGE=mcr.microsoft.com/dotnet/aspnet:10.0.15-noble@sha256:bfd912c83295ce66d4b706ebb8541b9f14259b0e76fbb88b2751f58ce2399d2e
ARG NODE_IMAGE=docker.io/library/node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1

# The search embedding model is downloaded from its pinned revision and every file's
# SHA-256 is verified by the same script development and CI use.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS model
COPY development/download-model.mjs /src/download-model.mjs
# Directories 0755, files 0644: the runtime COPY keeps these modes. (COPY --chmod would
# also apply its mode to the directories it creates, /opt/penny included, which locks
# the unprivileged app user out of /opt/penny/app.)
RUN node /src/download-model.mjs /model && chmod -R u=rwX,go=rX /model

FROM --platform=$BUILDPLATFORM ${SDK_IMAGE} AS build
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /src
COPY global.json NuGet.Config Directory.Build.props Directory.Packages.props ./
COPY src/Penny.Backend.Domain/Penny.Backend.Domain.csproj src/Penny.Backend.Domain/packages.lock.json src/Penny.Backend.Domain/
COPY src/Penny.Backend.Application/Penny.Backend.Application.csproj src/Penny.Backend.Application/packages.lock.json src/Penny.Backend.Application/
COPY src/Penny.Backend.Persistence/Penny.Backend.Persistence.csproj src/Penny.Backend.Persistence/packages.lock.json src/Penny.Backend.Persistence/
COPY src/Penny.Backend.Api/Penny.Backend.Api.csproj src/Penny.Backend.Api/packages.lock.json src/Penny.Backend.Api/
RUN dotnet restore src/Penny.Backend.Api/Penny.Backend.Api.csproj --locked-mode
COPY src/ src/
COPY development/grant-runtime.sql development/bootstrap.sql development/
ARG PENNY_VERSION=0.0.0-local
RUN dotnet publish src/Penny.Backend.Api/Penny.Backend.Api.csproj \
      --configuration Release --no-restore --output /app \
      -p:Version="${PENNY_VERSION%%-*}" -p:InformationalVersion="${PENNY_VERSION}" \
      -p:UseAppHost=false -p:GenerateDocumentationFile=false \
    && rm -f /app/*.pdb

FROM ${RUNTIME_IMAGE}
ARG PENNY_VERSION=0.0.0-local
ARG PENNY_REVISION=unknown
LABEL org.opencontainers.image.title="penny-api" \
      org.opencontainers.image.description="Penny ASP.NET Core API" \
      org.opencontainers.image.source="https://github.com/mfalicoff/penny" \
      org.opencontainers.image.version="${PENNY_VERSION}" \
      org.opencontainers.image.revision="${PENNY_REVISION}"
# Production defaults; every secret (connection strings, receipt key, OIDC and APNs
# credentials) is supplied at run time and never baked into the image.
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    Logging__Console__FormatterName=json \
    Logging__Console__FormatterOptions__TimestampFormat=yyyy-MM-ddTHH:mm:ss.fffZ \
    Search__ModelDirectory=/opt/penny/model \
    Receipts__Root=/var/lib/penny/receipts
# Receipt text extraction (MAZ-125) runs on this server only: Tesseract with English and
# French language data, poppler's pdftotext/pdfinfo/pdftoppm and libvips' command-line
# tools (bounded decoding of photos), from the Ubuntu 24.04 archive of the pinned base
# image, at pinned versions. prlimit (per-engine memory and CPU limits) is util-linux,
# part of the base image. A pin that the archive has replaced (a security update) fails
# the build: bump it to the version `apt-cache policy <package>` shows. To read other
# languages, derive an image that installs tesseract-ocr-<lang> and set Ocr__Languages
# (docs/operations.md#receipt-text-ocr).
ARG TESSERACT_VERSION=5.3.4-1build5
ARG TESSDATA_VERSION=1:4.1.0-2
ARG POPPLER_VERSION=24.02.0-1ubuntu9.11
ARG VIPS_VERSION=8.15.1-1.1build4
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      "tesseract-ocr=${TESSERACT_VERSION}" \
      "tesseract-ocr-eng=${TESSDATA_VERSION}" \
      "tesseract-ocr-fra=${TESSDATA_VERSION}" \
      "poppler-utils=${POPPLER_VERSION}" \
      "libvips-tools=${VIPS_VERSION}" \
    && command -v prlimit \
    && rm -rf /var/lib/apt/lists/*
COPY --from=model --chown=root:root /model/ /opt/penny/model/
COPY --from=build --chown=root:root /app/ /opt/penny/app/
# The receipt volume is the only writable application path; the app user owns it.
# /var/lib/penny/cutover is the mount point of the one-time cutover volume (MAZ-65,
# deploy/compose.cutover.yaml): an empty named volume takes this owner and mode.
RUN install -d -o "$APP_UID" -g "$APP_UID" -m 0700 /var/lib/penny/receipts /var/lib/penny/cutover
WORKDIR /opt/penny/app
USER $APP_UID
VOLUME ["/var/lib/penny/receipts"]
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["dotnet", "Penny.Backend.Api.dll", "health-probe"]
ENTRYPOINT ["dotnet", "Penny.Backend.Api.dll"]
